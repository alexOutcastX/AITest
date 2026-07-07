"""The maximum-return configuration: all three validated layers combined.

Layer 1  Long book   : Supertrend(14,3) long-only + overnight-gap long >EMA200
Layer 2  Short overlay: ORB(2-bar) breakdown short <EMA200, 1.5 ATR stop,
                        intraday only, taken when the long book is flat
Layer 3  Sizing      : volatility targeting min(3x, 20% / EWMA-20d vol)

Costs: 0.025%/side + 4.5%/yr futures carry drag on long notional.

Full period 2015-2024 net:  ~21.7% CAGR, -16.6% maxDD, Sharpe 1.31, PF 1.43
(carry-adjusted unlevered long book alone: 12.8% CAGR, -14.8% maxDD).

Run:  python full_stack.py
"""
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))
sys.path.insert(0, os.path.join(HERE, "short_selling"))
sys.path.insert(0, os.path.join(HERE, "leverage"))
import engine as E                    # noqa: E402
import short_strategies as SS         # noqa: E402
import leverage as L                  # noqa: E402

WINDOWS = {
    "TRAIN 2019-22": ("2019-03-27", "2022-04-01"),
    "TEST  2022-24": ("2022-04-01", "2024-03-27"),
    "OLD   2015-19": ("2015-01-09", "2019-03-27"),
    "FULL  2015-24": ("2015-01-09", "2024-03-27"),
}


def full_stack_pos(df):
    """Final fractional position series (-3 .. +3)."""
    book = SS.portfolio_with_short_overlay(df)   # layers 1 + 2
    return book * L.vol_target_lev(df)           # layer 3


if __name__ == "__main__":
    data = os.path.join(HERE, "..", "data", "nifty50_15min.csv")
    df = pd.read_csv(data, index_col=0, parse_dates=True)
    pd.set_option("display.width", 250)

    stack = {
        "1. Combo long (baseline)": L.combo_pos(df),
        "2. + ORB short overlay": SS.portfolio_with_short_overlay(df),
        "3. + vol targeting (<=3x)": full_stack_pos(df),
    }
    for wname, (a, b) in WINDOWS.items():
        d = df.loc[a:b]
        rows = [E.metrics(L.run_carry(d, pos.loc[a:b], label=n), d)
                for n, pos in stack.items()]
        print(f"\n=== {wname} (incl. 4.5%/yr carry drag on longs) ===")
        print(pd.DataFrame(rows)[["strategy", "cagr_%", "maxDD_%", "sharpe",
                                  "profit_factor", "trades", "ret_over_dd"]]
              .to_string(index=False))
