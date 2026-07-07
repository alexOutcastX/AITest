#!/usr/bin/env python3
"""Vectorized daily backtest engine with transaction costs and risk metrics.

Examples:
  python3 backtest.py --data data/AAPL.csv --strategy sma_cross --params fast=50,slow=200
  python3 backtest.py --data data/AAPL.csv --strategy-file my_strategy.py --params k=3
  python3 backtest.py --data data/AAPL.csv --strategy sma_cross \
      --optimize "fast=10:100:10,slow=100:300:25" --oos-split 0.3

Positions returned by a strategy are shifted one bar before being applied, so a
signal computed on bar t's close earns bar t+1's return (no lookahead).
"""

import argparse
import importlib.util
import itertools
import json
import math
import sys

import numpy as np
import pandas as pd

from strategies import REGISTRY

TRADING_DAYS = 252


# --------------------------------------------------------------------------- #
# Engine
# --------------------------------------------------------------------------- #


def run_backtest(
    df: pd.DataFrame,
    strategy,
    params: dict,
    capital: float = 10_000.0,
    commission_bps: float = 5.0,
    slippage_bps: float = 5.0,
) -> dict:
    target = strategy(df, **params).clip(-1, 1).fillna(0.0)
    pos = target.shift(1).fillna(0.0)  # trade at next bar; no lookahead

    asset_ret = df["Close"].pct_change().fillna(0.0)
    cost_rate = (commission_bps + slippage_bps) / 10_000
    turnover = pos.diff().abs().fillna(pos.abs())
    net_ret = pos * asset_ret - turnover * cost_rate

    equity = capital * (1 + net_ret).cumprod()
    return {
        "params": params,
        "positions": pos,
        "returns": net_ret,
        "equity": equity,
        "metrics": compute_metrics(net_ret, equity, pos, capital),
        "trades": extract_trades(pos, df["Close"]),
    }


def compute_metrics(net_ret: pd.Series, equity: pd.Series, pos: pd.Series, capital: float) -> dict:
    n = len(net_ret)
    years = n / TRADING_DAYS
    total_return = equity.iloc[-1] / capital - 1
    cagr = (equity.iloc[-1] / capital) ** (1 / years) - 1 if years > 0 else np.nan

    vol = net_ret.std() * math.sqrt(TRADING_DAYS)
    sharpe = net_ret.mean() / net_ret.std() * math.sqrt(TRADING_DAYS) if net_ret.std() > 0 else 0.0
    downside = net_ret[net_ret < 0].std()
    sortino = (
        net_ret.mean() / downside * math.sqrt(TRADING_DAYS)
        if downside and downside > 0
        else float("inf") if net_ret.mean() > 0 else 0.0
    )

    peak = equity.cummax()
    drawdown = equity / peak - 1
    max_dd = drawdown.min()
    calmar = cagr / abs(max_dd) if max_dd < 0 else float("inf")

    active = net_ret[pos != 0]
    var_95 = active.quantile(0.05) if len(active) else 0.0

    return {
        "start": str(net_ret.index[0].date()),
        "end": str(net_ret.index[-1].date()),
        "bars": n,
        "final_equity": round(float(equity.iloc[-1]), 2),
        "total_return_pct": round(100 * total_return, 2),
        "cagr_pct": round(100 * cagr, 2),
        "volatility_pct": round(100 * vol, 2),
        "sharpe": round(float(sharpe), 2),
        "sortino": round(float(sortino), 2) if math.isfinite(sortino) else "inf",
        "max_drawdown_pct": round(100 * float(max_dd), 2),
        "calmar": round(float(calmar), 2) if math.isfinite(calmar) else "inf",
        "daily_var_95_pct": round(100 * float(var_95), 2),
        "exposure_pct": round(100 * float((pos != 0).mean()), 1),
    }


def extract_trades(pos: pd.Series, close: pd.Series) -> dict:
    """Round trips: contiguous runs of a constant nonzero position."""
    run_id = (pos != pos.shift()).cumsum()
    pnls = []
    for _, seg in pos.groupby(run_id):
        direction = seg.iloc[0]
        if direction == 0:
            continue
        entry, exit_ = close[seg.index[0]], close[seg.index[-1]]
        pnls.append(direction * (exit_ / entry - 1))
    if not pnls:
        return {"count": 0}
    pnls = np.array(pnls)
    wins, losses = pnls[pnls > 0], pnls[pnls <= 0]
    profit_factor = wins.sum() / abs(losses.sum()) if losses.sum() != 0 else float("inf")
    return {
        "count": len(pnls),
        "win_rate_pct": round(100 * len(wins) / len(pnls), 1),
        "avg_trade_pct": round(100 * pnls.mean(), 2),
        "best_pct": round(100 * pnls.max(), 2),
        "worst_pct": round(100 * pnls.min(), 2),
        "profit_factor": round(float(profit_factor), 2) if math.isfinite(profit_factor) else "inf",
    }


# --------------------------------------------------------------------------- #
# CLI plumbing
# --------------------------------------------------------------------------- #


def coerce(value: str):
    if value.lower() in ("true", "false"):
        return value.lower() == "true"
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return value


def parse_params(spec: str | None) -> dict:
    if not spec:
        return {}
    return {k.strip(): coerce(v.strip()) for k, v in (kv.split("=", 1) for kv in spec.split(","))}


def parse_grid(spec: str) -> dict:
    """'fast=10:100:10,slow=100:300:25' -> {'fast': [10..100], 'slow': [100..300]}"""
    grid = {}
    for kv in spec.split(","):
        key, rng = kv.split("=", 1)
        parts = [coerce(x) for x in rng.split(":")]
        if len(parts) == 3:
            lo, hi, step = parts
            grid[key.strip()] = list(np.arange(lo, hi + step / 2, step).tolist())
        else:  # explicit list via 'a|b|c'
            grid[key.strip()] = [coerce(x) for x in rng.split("|")]
    return grid


def load_strategy(args):
    if args.strategy_file:
        spec = importlib.util.spec_from_file_location("user_strategy", args.strategy_file)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if not hasattr(mod, "strategy"):
            sys.exit(f"{args.strategy_file} must define strategy(df, **params)")
        return mod.strategy, args.strategy_file
    if args.strategy not in REGISTRY:
        sys.exit(f"unknown strategy {args.strategy!r}; available: {', '.join(REGISTRY)}")
    return REGISTRY[args.strategy], args.strategy


def print_report(name: str, result: dict, benchmark: dict) -> None:
    width = 22
    print(f"\n=== {name}  {result['params'] or ''}")
    print(f"{'metric':<{width}}{'strategy':>12}{'buy & hold':>12}")
    bench_m = benchmark["metrics"]
    for key, val in result["metrics"].items():
        print(f"{key:<{width}}{str(val):>12}{str(bench_m.get(key, '')):>12}")
    print("\ntrades:", json.dumps(result["trades"]))


def optimize(df, strategy, grid, base_params, args):
    split = int(len(df) * (1 - args.oos_split))
    train, test = df.iloc[:split], df.iloc[max(0, split - 1):]
    combos = [dict(zip(grid, vals)) for vals in itertools.product(*grid.values())]
    print(f"grid search: {len(combos)} combos, train {len(train)} bars / test {len(test)} bars")

    rows = []
    for combo in combos:
        params = {**base_params, **combo}
        try:
            m = run_backtest(train, strategy, params, args.capital, args.commission_bps, args.slippage_bps)["metrics"]
        except Exception as exc:  # noqa: BLE001 - a bad combo shouldn't kill the sweep
            print(f"  skipped {combo}: {exc}")
            continue
        rows.append({**combo, "train_sharpe": m["sharpe"], "train_cagr_pct": m["cagr_pct"],
                     "train_max_dd_pct": m["max_drawdown_pct"]})
    if not rows:
        sys.exit("no parameter combination produced a valid backtest")

    table = pd.DataFrame(rows).sort_values("train_sharpe", ascending=False)
    print("\ntop 10 by train Sharpe:")
    print(table.head(10).to_string(index=False))

    best = {k: table.iloc[0][k] for k in grid}
    best = {k: int(v) if float(v).is_integer() else float(v) for k, v in best.items()}
    best_params = {**base_params, **best}
    print(f"\nbest params: {best}")
    result = run_backtest(test, strategy, best_params, args.capital, args.commission_bps, args.slippage_bps)
    bench = run_backtest(test, REGISTRY["buy_hold"], {}, args.capital, args.commission_bps, args.slippage_bps)
    print_report("OUT-OF-SAMPLE (held-out test period)", result, bench)
    print("\nNOTE: judge the strategy on out-of-sample numbers; a big train/test gap = overfit.")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True, help="CSV from fetch_data.py")
    p.add_argument("--strategy", default="buy_hold")
    p.add_argument("--strategy-file", default=None, help="python file defining strategy(df, **params)")
    p.add_argument("--params", default=None, help="e.g. fast=50,slow=200")
    p.add_argument("--start", default=None)
    p.add_argument("--end", default=None)
    p.add_argument("--capital", type=float, default=10_000)
    p.add_argument("--commission-bps", type=float, default=5.0)
    p.add_argument("--slippage-bps", type=float, default=5.0)
    p.add_argument("--optimize", default=None, help='grid, e.g. "fast=10:100:10,slow=100:300:25"')
    p.add_argument("--oos-split", type=float, default=0.3, help="fraction held out for testing")
    p.add_argument("--json", default=None, help="write metrics+trades JSON here")
    p.add_argument("--equity-csv", default=None, help="write equity curve CSV here")
    args = p.parse_args()

    df = pd.read_csv(args.data, index_col="Date", parse_dates=True).sort_index()
    if args.start:
        df = df.loc[df.index >= pd.Timestamp(args.start)]
    if args.end:
        df = df.loc[df.index <= pd.Timestamp(args.end)]
    if len(df) < 30:
        sys.exit(f"only {len(df)} bars after filtering; need at least 30")

    strategy, name = load_strategy(args)
    params = parse_params(args.params)

    if args.optimize:
        optimize(df, strategy, parse_grid(args.optimize), params, args)
        return

    result = run_backtest(df, strategy, params, args.capital, args.commission_bps, args.slippage_bps)
    bench = run_backtest(df, REGISTRY["buy_hold"], {}, args.capital, args.commission_bps, args.slippage_bps)
    print_report(name, result, bench)

    if args.json:
        payload = {
            "strategy": name,
            "params": params,
            "costs_bps_per_side": args.commission_bps + args.slippage_bps,
            "metrics": result["metrics"],
            "trades": result["trades"],
            "benchmark_metrics": bench["metrics"],
        }
        with open(args.json, "w") as fh:
            json.dump(payload, fh, indent=2)
        print(f"\nwrote {args.json}")
    if args.equity_csv:
        pd.DataFrame({"strategy": result["equity"], "buy_hold": bench["equity"]}).to_csv(args.equity_csv)
        print(f"wrote {args.equity_csv}")


if __name__ == "__main__":
    main()
