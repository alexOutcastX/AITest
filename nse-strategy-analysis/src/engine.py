"""Vectorized 15-min backtest engine for NIFTY 50 index strategies.

Conventions:
- Signals are computed on bar close; positions apply from the NEXT bar
  (position series is shifted before computing returns) -> no lookahead.
- Intraday strategies are flat by the last bar of the day (15:15 bar).
- Costs are charged on every unit of position change (entry, exit, flip).
"""
import numpy as np
import pandas as pd

COST_PER_SIDE = 0.00025  # 0.025% per side: NIFTY futures friction + 1-2 pt slippage
ANN_FACTOR = 252 * 25    # 25 fifteen-minute bars per session


# ---------------- indicators ----------------

def ema(s, n):
    return s.ewm(span=n, adjust=False).mean()

def rsi(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return 100 - 100 / (1 + rs)

def atr(df, n=14):
    h, l, c = df["High"], df["Low"], df["Close"]
    pc = c.shift()
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()

def supertrend(df, n=10, mult=3.0):
    """Returns direction series: +1 uptrend, -1 downtrend."""
    hl2 = (df["High"] + df["Low"]) / 2
    a = atr(df, n)
    ub = (hl2 + mult * a).values
    lb = (hl2 - mult * a).values
    close = df["Close"].values
    n_bars = len(df)
    fub = ub.copy()
    flb = lb.copy()
    dirn = np.ones(n_bars)
    for i in range(1, n_bars):
        fub[i] = ub[i] if (ub[i] < fub[i-1] or close[i-1] > fub[i-1]) else fub[i-1]
        flb[i] = lb[i] if (lb[i] > flb[i-1] or close[i-1] < flb[i-1]) else flb[i-1]
        if dirn[i-1] == 1:
            dirn[i] = -1 if close[i] < flb[i] else 1
        else:
            dirn[i] = 1 if close[i] > fub[i] else -1
    return pd.Series(dirn, index=df.index)

def vwap_daily(df):
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    day = df.index.normalize()
    # index data has no volume; use time-weighted session mean of typical price
    return tp.groupby(day).expanding().mean().reset_index(level=0, drop=True)

def macd(close, fast=12, slow=26, sig=9):
    line = ema(close, fast) - ema(close, slow)
    signal = ema(line, sig)
    return line, signal


# ---------------- backtest core ----------------

def flatten_eod(pos, index):
    """Force position to 0 on the last bar of each day (square-off at close)."""
    pos = pos.copy()
    last_bar = pd.Series(index.normalize(), index=index).groupby(
        index.normalize()).transform("max")  # placeholder, replaced below
    is_last = pd.Series(index, index=index).groupby(index.normalize()).transform("max") == index
    pos[is_last.values] = 0
    return pos

def run(df, pos, cost=COST_PER_SIDE, label=""):
    """pos: desired position (+1/0/-1) decided at each bar's CLOSE."""
    pos = pos.fillna(0)
    held = pos.shift(1).fillna(0)                      # position during current bar
    bar_ret = df["Close"].pct_change().fillna(0)
    # no overnight carry for intraday strats is handled by flatten_eod upstream;
    # positional strats do carry the overnight gap (first bar pct_change covers it)
    gross = held * bar_ret
    turns = pos.diff().abs().fillna(pos.abs())
    net = gross - turns * cost
    eq = (1 + net).cumprod()
    return {"label": label, "pos": pos, "net": net, "eq": eq, "cost": cost}

def trades_from_pos(df, pos, cost=COST_PER_SIDE):
    """Split the net return stream into individual trades for PF/win-rate.

    A trade ends when the held position goes to zero OR flips sign.
    """
    pos = pos.fillna(0)
    held = pos.shift(1).fillna(0)
    bar_ret = df["Close"].pct_change().fillna(0)
    net = (held * bar_ret - pos.diff().abs().fillna(pos.abs()) * cost).values
    hv = held.values
    trades = []
    cur = 0.0
    prev = 0.0
    for r, p in zip(net, hv):
        if p != 0 and prev != 0 and np.sign(p) != np.sign(prev):
            trades.append(cur)          # flip: close old trade, start new one
            cur = 0.0
        if p != 0:
            cur += r
        elif prev != 0:
            trades.append(cur + r)       # exit bar: cost charged this bar
            cur = 0.0
        prev = p
    if prev != 0:
        trades.append(cur)
    return np.array(trades)

def metrics(res, df):
    net, eq = res["net"], res["eq"]
    cost = res.get("cost", COST_PER_SIDE)
    yrs = (df.index[-1] - df.index[0]).days / 365.25
    total = eq.iloc[-1] - 1
    cagr = eq.iloc[-1] ** (1 / yrs) - 1 if yrs > 0 else np.nan
    dd = (eq / eq.cummax() - 1).min()
    daily = net.groupby(net.index.normalize()).sum()
    sharpe = daily.mean() / daily.std() * np.sqrt(252) if daily.std() > 0 else np.nan
    tr = trades_from_pos(df, res["pos"], cost=cost)
    wins, losses = tr[tr > 0], tr[tr < 0]
    pf = wins.sum() / abs(losses.sum()) if losses.size and abs(losses.sum()) > 0 else np.inf
    return {
        "strategy": res["label"],
        "total_ret_%": round(total * 100, 1),
        "cagr_%": round(cagr * 100, 2),
        "maxDD_%": round(dd * 100, 2),
        "sharpe": round(sharpe, 2),
        "profit_factor": round(pf, 2),
        "win_rate_%": round(100 * len(wins) / len(tr), 1) if len(tr) else np.nan,
        "trades": len(tr),
        "avg_trade_%": round(tr.mean() * 100, 4) if len(tr) else np.nan,
        "ret_over_dd": round((cagr * 100) / abs(dd * 100), 2) if dd != 0 else np.nan,
    }


# ---------------- strategies (each returns a desired-position series) ----------------

def strat_ema_cross(df, fast=9, slow=21, trend=200, intraday=True, allow_short=True):
    f, s, t = ema(df.Close, fast), ema(df.Close, slow), ema(df.Close, trend)
    pos = pd.Series(0.0, index=df.index)
    pos[(f > s) & (df.Close > t)] = 1
    if allow_short:
        pos[(f < s) & (df.Close < t)] = -1
    return flatten_eod(pos, df.index) if intraday else pos

def strat_supertrend(df, n=10, mult=3.0, intraday=False, allow_short=True):
    d = supertrend(df, n, mult)
    pos = d.clip(lower=0) if not allow_short else d
    return flatten_eod(pos, df.index) if intraday else pos

def strat_st_ema(df, n=10, mult=2.5, trend=200, intraday=False):
    """Supertrend direction gated by EMA trend filter, long/short."""
    d = supertrend(df, n, mult)
    t = ema(df.Close, trend)
    pos = pd.Series(0.0, index=df.index)
    pos[(d > 0) & (df.Close > t)] = 1
    pos[(d < 0) & (df.Close < t)] = -1
    return flatten_eod(pos, df.index) if intraday else pos

def strat_orb(df, or_bars=1, use_atr_sl=True, sl_atr=1.0, target_atr=None):
    """Opening range breakout, intraday, one trade side switch allowed via stop."""
    day = df.index.normalize()
    g = df.groupby(day)
    bar_no = g.cumcount()
    or_high = df.High.where(bar_no < or_bars).groupby(day).transform("max")
    or_low = df.Low.where(bar_no < or_bars).groupby(day).transform("min")
    a = atr(df, 14)
    long_sig = (df.Close > or_high) & (bar_no >= or_bars)
    short_sig = (df.Close < or_low) & (bar_no >= or_bars)
    pos = np.zeros(len(df))
    entry = 0.0
    stop = 0.0
    cur = 0
    days = day.values
    close = df.Close.values
    lo = df.Low.values
    hi = df.High.values
    avals = a.values
    lastbar = (pd.Series(df.index, index=df.index).groupby(day).transform("max") == df.index).values
    ls, ss = long_sig.values, short_sig.values
    for i in range(len(df)):
        if i > 0 and days[i] != days[i-1]:
            cur = 0
        if cur == 1 and use_atr_sl and lo[i] <= stop:
            cur = 0
        elif cur == -1 and use_atr_sl and hi[i] >= stop:
            cur = 0
        if cur == 0:
            if ls[i]:
                cur = 1; entry = close[i]; stop = entry - sl_atr * avals[i]
            elif ss[i]:
                cur = -1; entry = close[i]; stop = entry + sl_atr * avals[i]
        if lastbar[i]:
            pos[i] = 0
        else:
            pos[i] = cur
    return pd.Series(pos, index=df.index)

def strat_vwap_trend(df, band_atr=0.5, intraday=True):
    v = vwap_daily(df)
    a = atr(df, 14)
    pos = pd.Series(0.0, index=df.index)
    pos[df.Close > v + band_atr * a] = 1
    pos[df.Close < v - band_atr * a] = -1
    return flatten_eod(pos, df.index) if intraday else pos

def strat_bollinger_breakout(df, n=20, k=2.0, intraday=True):
    m = df.Close.rolling(n).mean()
    sd = df.Close.rolling(n).std()
    pos = pd.Series(np.nan, index=df.index)
    pos[df.Close > m + k * sd] = 1
    pos[df.Close < m - k * sd] = -1
    pos[(df.Close < m) & (pos.ffill() == 1)] = 0
    pos[(df.Close > m) & (pos.ffill() == -1)] = 0
    pos = pos.ffill().fillna(0)
    return flatten_eod(pos, df.index) if intraday else pos

def strat_rsi2_mr(df, lo=10, hi=60, trend=200, intraday=False):
    """RSI(2) dip-buying above 200EMA (long only)."""
    r2 = rsi(df.Close, 2)
    t = ema(df.Close, trend)
    pos = pd.Series(np.nan, index=df.index)
    pos[(r2 < lo) & (df.Close > t)] = 1
    pos[r2 > hi] = 0
    pos[df.Close < t] = 0
    pos = pos.ffill().fillna(0)
    return flatten_eod(pos, df.index) if intraday else pos

def strat_donchian(df, n=20, intraday=False):
    hh = df.High.rolling(n).max().shift()
    ll = df.Low.rolling(n).min().shift()
    mid = (hh + ll) / 2
    pos = pd.Series(np.nan, index=df.index)
    pos[df.Close > hh] = 1
    pos[df.Close < ll] = -1
    pos[(df.Close < mid) & (pos.ffill() == 1)] = 0
    pos[(df.Close > mid) & (pos.ffill() == -1)] = 0
    pos = pos.ffill().fillna(0)
    return flatten_eod(pos, df.index) if intraday else pos

def strat_macd(df, fast=12, slow=26, sig=9, trend=200, intraday=False):
    line, signal = macd(df.Close, fast, slow, sig)
    t = ema(df.Close, trend)
    pos = pd.Series(0.0, index=df.index)
    pos[(line > signal) & (df.Close > t)] = 1
    pos[(line < signal) & (df.Close < t)] = -1
    return flatten_eod(pos, df.index) if intraday else pos
