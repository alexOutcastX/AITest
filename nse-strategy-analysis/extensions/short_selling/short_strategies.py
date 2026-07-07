"""Final SHORT-side strategies for NIFTY 50 15-min data.

Same conventions as engine.py: each function returns a desired-position series
(0/-1, or mixed for the portfolio book) decided at bar close, applied next bar
by E.run(). All intraday shorts are flat on the last bar of each day.

Selected on TRAIN = 2019-03-27..2022-04-01, validated on
TEST = 2022-04-01..2024-03-27 and OLD = 2015-01-09..2019-03-27.

Usage:
    import engine as E, short_strategies as S
    df = pd.read_csv("nifty50_15min.csv", index_col=0, parse_dates=True)
    res = E.run(df, S.short_orb_breakdown(df)); E.metrics(res, df)
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np
import pandas as pd
import engine as E


# ---------------- helpers ----------------

def _day(df):
    return df.index.normalize()

def _bar_no(df):
    return df.groupby(_day(df)).cumcount()

def _is_last_bar(df):
    day = _day(df)
    return pd.Series(df.index, index=df.index).groupby(day).transform("max") == df.index

def _short_trade_loop(df, sig, sl_atr):
    """One short per signal; ATR stop on High touch; forced flat on last bar of day.

    sig: boolean entry signal evaluated at bar close (position applies next bar
    via E.run's shift). Re-entry within the day is allowed if sig fires again.
    """
    A = E.atr(df, 14)
    pos = np.zeros(len(df))
    days = _day(df).values
    hi = df.High.values
    cl = df.Close.values
    av = A.values
    sg = sig.values
    lb = _is_last_bar(df).values
    cur = 0
    stop = 0.0
    for i in range(len(df)):
        if i > 0 and days[i] != days[i - 1]:
            cur = 0                                  # never carry overnight
        if cur == -1 and hi[i] >= stop:
            cur = 0                                  # stopped out
        if cur == 0 and sg[i]:
            cur = -1
            stop = cl[i] + sl_atr * av[i]
        pos[i] = 0 if lb[i] else cur                 # square off at 15:15
    return pd.Series(pos, index=df.index)


# ---------------- final strategies ----------------

def short_orb_breakdown(df, or_bars=2, sl_atr=1.5, trend_ema=200):
    """PRIMARY. Opening-range breakdown short, downtrend-gated.

    Rules: opening range = first `or_bars` 15-min bars (default 09:15-09:45).
    Short when a bar CLOSES below the OR low AND Close < EMA(trend_ema).
    Stop = entry close + sl_atr * ATR(14) (exit when High touches it).
    Square off at 15:15. Re-entry allowed if the signal fires again.

    Neighbors (all ~flat-or-positive OOS): or_bars 1-3, sl 1.5-2.5, EMA 200-400.
    """
    day = _day(df)
    bn = _bar_no(df)
    or_low = df.Low.where(bn < or_bars).groupby(day).transform("min")
    gate = df.Close < E.ema(df.Close, trend_ema)
    sig = (df.Close < or_low) & (bn >= or_bars) & gate
    return _short_trade_loop(df, sig, sl_atr)


def short_gap_fade(df, min_gap_atr=0.35, sl_atr=1.5):
    """SECONDARY. Fade material gap-ups; ride the negative intraday drift.

    Rules: if today's open > yesterday's close + min_gap_atr * yesterday's
    closing ATR(14), go short at the CLOSE of the first bar (09:30 onward).
    Stop = entry close + sl_atr * ATR(14); otherwise hold to the 15:15 square-off.

    Neighbors: gap threshold 0.3-0.5 ATR all positive in TRAIN/TEST/OLD.
    """
    day = _day(df)
    bn = _bar_no(df)
    dayser = pd.Series(day, index=df.index)
    A = E.atr(df, 14)
    prev_cl = dayser.map(df.Close.groupby(day).last().shift(1))
    prev_atr = dayser.map(A.groupby(day).last().shift(1))
    dopen = df.Open.groupby(day).transform("first")
    sig = ((dopen - prev_cl) > min_gap_atr * prev_atr) & (bn == 0)
    return _short_trade_loop(df, sig, sl_atr)


def short_union(df):
    """Combined short book: short whenever either final strategy is short (max 1x)."""
    return pd.concat([short_orb_breakdown(df), short_gap_fade(df)], axis=1).min(axis=1)


# ---------------- long book + overlay portfolio ----------------

def long_book(df):
    """Reference long system: ST(14,3) long-only + overnight long above EMA200."""
    base = E.strat_supertrend(df, 14, 3.0, allow_short=False)
    overnight = pd.Series(0.0, index=df.index)
    overnight[_is_last_bar(df) & (df.Close > E.ema(df.Close, 200))] = 1.0
    return pd.concat([base, overnight], axis=1).max(axis=1)


def portfolio_with_short_overlay(df, short_fn=short_orb_breakdown):
    """Long book, plus the short signal only on bars where the long book is flat."""
    lb = long_book(df)
    s = short_fn(df)
    return lb + s * (lb == 0)
