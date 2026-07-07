"""Final strategies from the NSE 15-min analysis.

Position convention: value decided at each bar's CLOSE, applied from the next
bar by the engine (engine.run shifts internally — do not pre-shift).
"""
import pandas as pd
import engine as E


def strat_overnight_gap(df, trend=200):
    """Overnight drift capture: long only on the last 15-min bar of the day
    (carried through the overnight gap, exited at the next day's first bar
    close), and only while Close > EMA(trend).

    2015-24 net: ~11.9% CAGR, -7.9% maxDD, PF 1.75, 62% win rate.
    """
    idx = df.index
    is_last = pd.Series(idx, index=idx).groupby(idx.normalize()).transform("max") == idx
    pos = pd.Series(0.0, index=idx)
    pos[is_last.values] = 1.0
    if trend:
        pos[df.Close <= E.ema(df.Close, trend)] = 0.0
    return pos


def strat_st_long(df, n=14, mult=3.0):
    """Supertrend(14, 3) long-only swing: hold while direction is up, flat
    while down. Carries positions overnight (that is where the return is)."""
    return E.strat_supertrend(df, n, mult, allow_short=False)


def strat_combo(df):
    """RECOMMENDED: ST(14,3) long-only, plus overnight-gap capture on days the
    trend system is flat but price is still above EMA200.

    2015-24 net: ~15.6% CAGR, -14.0% maxDD, PF 1.55, Sharpe 1.26
    (buy & hold over the same period: 11.2% CAGR, -38.8% maxDD).
    """
    base = strat_st_long(df)
    on = strat_overnight_gap(df, trend=200)
    return pd.concat([base, on], axis=1).max(axis=1)


def strat_ensemble(df):
    """Equal-weight ensemble of three trend systems — smoother equity:
    ST(10,3)+EMA200 L/S, ST(20,2.5)+EMA100 L/S, ST(14,3) long-only.

    2015-24 net: ~13.9% CAGR, -10.2% maxDD, PF 1.38.
    """
    return (E.strat_st_ema(df, 10, 3.0, 200)
            + E.strat_st_ema(df, 20, 2.5, 100)
            + E.strat_supertrend(df, 14, 3.0, allow_short=False)) / 3.0
