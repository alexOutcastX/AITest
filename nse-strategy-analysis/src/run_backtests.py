"""Reproduce every table in the report.

Usage:  python src/run_backtests.py   (from the nse-strategy-analysis folder)
"""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import engine as E
import strategies as S

pd.set_option("display.width", 250)

DATA = os.path.join(os.path.dirname(__file__), "..", "data", "nifty50_15min.csv")
full = pd.read_csv(DATA, index_col=0, parse_dates=True)

WINDOWS = {
    "TRAIN 2019-22": ("2019-03-27", "2022-04-01"),
    "TEST  2022-24": ("2022-04-01", "2024-03-27"),
    "OLD   2015-19": ("2015-01-09", "2019-03-27"),
    "FULL  2015-24": ("2015-01-09", "2024-03-27"),
}

CANDIDATES = {
    "Buy & hold": None,
    "ST(14,3) long + overnight  [RECOMMENDED]": S.strat_combo,
    "Overnight gap > EMA200": S.strat_overnight_gap,
    "Ensemble (3 systems)": S.strat_ensemble,
    "ST(14,3) long-only": S.strat_st_long,
    "ST(14,3)+EMA200 L/S": lambda d: E.strat_st_ema(d, 14, 3.0, 200),
    "ORB 30min + 1 ATR SL (intraday)": lambda d: E.strat_orb(d, or_bars=2),
    "EMA 9/21 x200 (intraday L/S)": lambda d: E.strat_ema_cross(d),
}


def bh_metrics(w):
    eq = w.Close / w.Close.iloc[0]
    yrs = (w.index[-1] - w.index[0]).days / 365.25
    return {
        "strategy": "Buy & hold",
        "cagr_%": round((eq.iloc[-1] ** (1 / yrs) - 1) * 100, 2),
        "maxDD_%": round((eq / eq.cummax() - 1).min() * 100, 2),
    }


for wname, (a, b) in WINDOWS.items():
    w = full[(full.index >= a) & (full.index < b)]
    rows = []
    for name, fn in CANDIDATES.items():
        if fn is None:
            rows.append(bh_metrics(w))
            continue
        rows.append(E.metrics(E.run(w, fn(w), label=name), w))
    print(f"\n=== {wname} ===")
    cols = ["strategy", "cagr_%", "maxDD_%", "sharpe", "profit_factor",
            "win_rate_%", "trades", "ret_over_dd"]
    t = pd.DataFrame(rows)
    print(t[[c for c in cols if c in t.columns]].to_string(index=False))
