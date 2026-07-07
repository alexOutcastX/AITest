"""Built-in strategies and indicator helpers.

A strategy is a function (df, **params) -> pd.Series of target positions in
[-1, 1], indexed like df. The value at bar t is the position DESIRED AFTER
observing bar t's close; the engine shifts it one bar before applying it, so
strategies must NOT shift themselves (that would double-lag the signal).

df columns: Open, High, Low, Close, Volume with a DatetimeIndex.
"""

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------- #
# Indicator helpers (importable by custom strategy files)
# --------------------------------------------------------------------------- #


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(int(period)).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=int(period), adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def macd_lines(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = macd_line.ewm(span=int(signal), adjust=False).mean()
    return macd_line, signal_line


def bollinger_bands(series: pd.Series, period: int = 20, num_std: float = 2.0):
    mid = sma(series, period)
    std = series.rolling(int(period)).std()
    return mid + num_std * std, mid, mid - num_std * std


def _directional(long_signal: pd.Series, allow_short: bool) -> pd.Series:
    """Map a boolean 'be long' signal to positions, optionally short otherwise."""
    pos = long_signal.astype(float)
    if allow_short:
        pos = pos * 2 - 1
    return pos


# --------------------------------------------------------------------------- #
# Strategies
# --------------------------------------------------------------------------- #


def buy_hold(df: pd.DataFrame) -> pd.Series:
    return pd.Series(1.0, index=df.index)


def sma_cross(df: pd.DataFrame, fast: int = 50, slow: int = 200, allow_short: bool = False) -> pd.Series:
    long = sma(df["Close"], fast) > sma(df["Close"], slow)
    return _directional(long, allow_short)


def ema_cross(df: pd.DataFrame, fast: int = 12, slow: int = 26, allow_short: bool = False) -> pd.Series:
    long = ema(df["Close"], fast) > ema(df["Close"], slow)
    return _directional(long, allow_short)


def rsi_reversal(df: pd.DataFrame, period: int = 14, lower: float = 30, upper: float = 70) -> pd.Series:
    """Buy when RSI dips below `lower`, exit when it recovers above `upper`."""
    r = rsi(df["Close"], int(period))
    pos = pd.Series(np.nan, index=df.index)
    pos[r < lower] = 1.0
    pos[r > upper] = 0.0
    return pos.ffill().fillna(0.0)


def macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9, allow_short: bool = False) -> pd.Series:
    macd_line, signal_line = macd_lines(df["Close"], fast, slow, signal)
    return _directional(macd_line > signal_line, allow_short)


def bollinger(df: pd.DataFrame, period: int = 20, num_std: float = 2.0) -> pd.Series:
    """Mean reversion: buy at the lower band, exit at the middle band."""
    upper_b, mid, lower_b = bollinger_bands(df["Close"], int(period), float(num_std))
    close = df["Close"]
    pos = pd.Series(np.nan, index=df.index)
    pos[close < lower_b] = 1.0
    pos[close > mid] = 0.0
    return pos.ffill().fillna(0.0)


def momentum(df: pd.DataFrame, lookback: int = 126, allow_short: bool = False) -> pd.Series:
    trailing = df["Close"].pct_change(int(lookback))
    return _directional(trailing > 0, allow_short)


REGISTRY = {
    "buy_hold": buy_hold,
    "sma_cross": sma_cross,
    "ema_cross": ema_cross,
    "rsi_reversal": rsi_reversal,
    "macd": macd,
    "bollinger": bollinger,
    "momentum": momentum,
}
