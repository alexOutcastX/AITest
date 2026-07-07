"""True out-of-sample validation on 2024-03-27 .. 2025-04-07.

This window postdates every design/optimization decision in this repo (all
strategies were frozen on data ending 2024-03-26). OOS data source:
https://github.com/rajgmishra/nifty50-15min-ohlc (15-min candles; agrees with
the primary vendor to ~4.5 bps in the overlapping month).

Usage:  python src/run_oos.py
"""
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "extensions", "short_selling"))
sys.path.insert(0, os.path.join(HERE, "..", "extensions", "leverage"))
import engine as E                # noqa: E402
import strategies as S            # noqa: E402
import short_strategies as SS     # noqa: E402
import leverage as L              # noqa: E402

pd.set_option("display.width", 250)

DATA = os.path.join(HERE, "..", "data")
old = pd.read_csv(os.path.join(DATA, "nifty50_15min.csv"),
                  index_col=0, parse_dates=True)
new = pd.read_csv(os.path.join(DATA, "nifty50_15min_2024_25.csv"),
                  index_col=0, parse_dates=True)
full = pd.concat([old, new])
full = full[~full.index.duplicated()].sort_index()

A, B = "2024-03-27", "2025-04-09"
w = full.loc[A:B]

eq = w.Close / w.Close.iloc[0]
yrs = (w.index[-1] - w.index[0]).days / 365.25
print(f"OOS {w.index[0].date()} .. {w.index[-1].date()}  |  buy & hold: "
      f"total {(eq.iloc[-1]-1)*100:+.1f}%, CAGR {(eq.iloc[-1]**(1/yrs)-1)*100:.1f}%, "
      f"maxDD {(eq/eq.cummax()-1).min()*100:.1f}%")

CANDS = {
    "ST(14,3) long + overnight  [RECOMMENDED]": S.strat_combo,
    "Overnight gap > EMA200": S.strat_overnight_gap,
    "Ensemble (3 systems)": S.strat_ensemble,
    "ST(14,3) long-only": S.strat_st_long,
    "ST(14,3)+EMA200 L/S": lambda d: E.strat_st_ema(d, 14, 3.0, 200),
    "ORB 30min + 1 ATR SL (intraday)": lambda d: E.strat_orb(d, or_bars=2),
}
# positions computed on the full series (warm indicators), metrics on the OOS slice
rows = [E.metrics(E.run(w, fn(full).loc[A:B], label=n), w) for n, fn in CANDS.items()]
print(pd.DataFrame(rows)[["strategy", "cagr_%", "maxDD_%", "sharpe",
                          "profit_factor", "win_rate_%", "trades",
                          "ret_over_dd"]].to_string(index=False))

STACK = {
    "1. Combo long (carry-adj)": L.combo_pos(full),
    "2. + ORB short overlay": SS.portfolio_with_short_overlay(full),
    "3. + vol targeting <=3x": SS.portfolio_with_short_overlay(full) * L.vol_target_lev(full),
}
rows = [E.metrics(L.run_carry(w, pos.loc[A:B], label=n), w)
        for n, pos in STACK.items()]
print("\nFull stack on OOS (incl. 4.5%/yr carry drag on longs):")
print(pd.DataFrame(rows)[["strategy", "cagr_%", "maxDD_%", "sharpe",
                          "profit_factor", "trades", "ret_over_dd"]]
      .to_string(index=False))
