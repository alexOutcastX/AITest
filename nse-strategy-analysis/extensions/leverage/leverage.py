"""Final position-sizing scheme for the NIFTY 50 combo strategy.

Strategy : ST(14,3) long-only + overnight (last bar of day) long if Close>EMA200
Sizing   : volatility targeting, size = min(3.0, 20% / realized_vol)
           realized_vol = 20-day EWMA of daily close-to-close returns,
           annualized, SHIFTED BY 1 DAY (no lookahead).
Costs    : 0.025%/side on every unit of position change, PLUS a futures
           cost-of-carry drag of 4.5%/yr charged on all LONG notional
           (NIFTY futures trade above spot by ~repo - dividends; the drag
           is applied per bar as 0.045/(252*25) * held).

Run:  python leverage.py
"""
import sys, os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "src"))
import engine as E

# ---------------- final parameters ----------------
TARGET_VOL = 0.20      # annualized volatility target
MAX_LEV = 3.0          # hard cap (NIFTY SPAN margin allows ~5x; 3x keeps buffer)
VOL_SPAN = 20          # days, EWMA span for realized vol
CARRY = 0.045          # annual futures carry drag on long notional
CARRY_PER_BAR = CARRY / (252 * 25)

WINDOWS = {
    "OLD":   ("2015-01-09", "2019-03-27"),
    "TRAIN": ("2019-03-27", "2022-04-01"),
    "TEST":  ("2022-04-01", "2024-03-27"),
    "FULL":  ("2015-01-09", "2024-03-27"),
}


def combo_pos(df, n=14, mult=3.0):
    """Baseline combo signal (unlevered, 0/1)."""
    base = E.strat_supertrend(df, n, mult, allow_short=False)
    is_last = (pd.Series(df.index, index=df.index)
               .groupby(df.index.normalize()).transform("max") == df.index)
    overnight = pd.Series(0.0, index=df.index)
    overnight[is_last & (df.Close > E.ema(df.Close, 200))] = 1.0
    return pd.concat([base, overnight], axis=1).max(axis=1)


def vol_target_lev(df, target=TARGET_VOL, max_lev=MAX_LEV, span=VOL_SPAN):
    """Daily leverage multiplier from EWMA realized vol; uses only past days."""
    dclose = df.Close.groupby(df.index.normalize()).last()
    dret = dclose.pct_change()
    ann_vol = np.sqrt((dret ** 2).ewm(span=span, adjust=False).mean() * 252)
    lev = (target / ann_vol.shift(1)).clip(upper=max_lev).fillna(1.0)
    days = df.index.normalize()
    return pd.Series(lev.reindex(days).values, index=df.index)


def final_pos(df):
    """The recommended position series (fractional, 0..3)."""
    return combo_pos(df) * vol_target_lev(df)


def run_carry(df, pos, cost=0.00025, label=""):
    """Engine run + carry drag on long notional."""
    res = E.run(df, pos, cost=cost, label=label)
    held = pos.shift(1).fillna(0)
    res["net"] = res["net"] - held.clip(lower=0) * CARRY_PER_BAR
    res["eq"] = (1 + res["net"]).cumprod()
    return res


if __name__ == "__main__":
    df = pd.read_csv(os.path.join(HERE, "..", "..", "data", "nifty50_15min.csv"),
                     index_col=0, parse_dates=True)
    pos = final_pos(df)
    print(f"vol-target {TARGET_VOL:.0%} / cap {MAX_LEV:g}x  (carry {CARRY:.1%}/yr on longs)")
    for w, (a, b) in WINDOWS.items():
        d = df.loc[a:b]
        m = E.metrics(run_carry(d, pos.loc[a:b], label=w), d)
        print(f"  {w:5s} CAGR {m['cagr_%']:6.2f}%  maxDD {m['maxDD_%']:7.2f}%  "
              f"Sharpe {m['sharpe']:5.2f}  PF {m['profit_factor']:5.2f}  "
              f"r/DD {m['ret_over_dd']:5.2f}")
    r = run_carry(df, pos)
    daily = r["net"].groupby(r["net"].index.normalize()).sum()
    print(f"  worst single day: {daily.min()*100:.2f}% on {daily.idxmin().date()}")
    print("  cost sensitivity (FULL period):")
    for c in (0.0001, 0.00025, 0.0005):
        m = E.metrics(run_carry(df, pos, cost=c), df)
        print(f"    {c*100:.3f}%/side  CAGR {m['cagr_%']:6.2f}%  maxDD {m['maxDD_%']:7.2f}%  "
              f"Sharpe {m['sharpe']:5.2f}")
