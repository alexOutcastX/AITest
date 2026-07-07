#!/usr/bin/env python3
"""Fetch daily OHLCV data for a ticker and save it as a normalized CSV.

Sources, tried in order unless --source pins one:
  yfinance  - Yahoo Finance (adjusted OHLC)
  stooq     - free CSV endpoint, no API key
  synthetic - geometric Brownian motion, for offline pipeline testing only

Output CSV columns: Date, Open, High, Low, Close, Volume (Date ascending).
"""

import argparse
import io
import os
import sys
import urllib.request

import numpy as np
import pandas as pd

COLUMNS = ["Open", "High", "Low", "Close", "Volume"]


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    df.index.name = "Date"
    df = df[COLUMNS].astype(float).sort_index()
    df = df[~df.index.duplicated(keep="last")].dropna(subset=["Close"])
    return df


def fetch_yfinance(ticker: str, start: str, end: str | None) -> pd.DataFrame:
    import yfinance as yf

    df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
    if df is None or df.empty:
        raise RuntimeError(f"yfinance returned no data for {ticker}")
    if isinstance(df.columns, pd.MultiIndex):  # yfinance >=0.2 multi-ticker shape
        df.columns = df.columns.get_level_values(0)
    return normalize(df)


def fetch_stooq(ticker: str, start: str, end: str | None) -> pd.DataFrame:
    symbol = ticker.lower()
    if "." not in symbol:  # bare US tickers need the .us suffix on Stooq
        symbol += ".us"
    url = f"https://stooq.com/q/d/l/?s={symbol}&i=d"
    with urllib.request.urlopen(url, timeout=30) as resp:
        raw = resp.read().decode()
    if not raw.startswith("Date,"):
        raise RuntimeError(f"Stooq returned no data for {ticker}")
    df = pd.read_csv(io.StringIO(raw), index_col="Date")
    df = normalize(df)
    df = df.loc[df.index >= pd.Timestamp(start)]
    if end:
        df = df.loc[df.index <= pd.Timestamp(end)]
    if df.empty:
        raise RuntimeError(f"Stooq data for {ticker} has no rows in range")
    return df


def fetch_synthetic(ticker: str, start: str, end: str | None) -> pd.DataFrame:
    end = end or pd.Timestamp.today().strftime("%Y-%m-%d")
    dates = pd.bdate_range(start, end)
    rng = np.random.default_rng(abs(hash(ticker)) % 2**32)  # reproducible per ticker
    rets = rng.normal(0.0003, 0.015, len(dates))
    close = 100 * np.exp(np.cumsum(rets))
    intraday = rng.uniform(0.001, 0.02, len(dates))
    df = pd.DataFrame(
        {
            "Open": close * (1 - intraday / 2),
            "High": close * (1 + intraday),
            "Low": close * (1 - intraday),
            "Close": close,
            "Volume": rng.integers(1e6, 5e7, len(dates)).astype(float),
        },
        index=dates,
    )
    return normalize(df)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("ticker")
    p.add_argument("--start", default="2015-01-01")
    p.add_argument("--end", default=None)
    p.add_argument("--out", default=None, help="output CSV path (default data/<TICKER>.csv)")
    p.add_argument("--source", choices=["auto", "yfinance", "stooq", "synthetic"], default="auto")
    p.add_argument("--force", action="store_true", help="refetch even if the CSV exists")
    args = p.parse_args()

    out = args.out or os.path.join("data", f"{args.ticker.upper()}.csv")
    if os.path.exists(out) and not args.force:
        df = pd.read_csv(out, index_col="Date", parse_dates=True)
        print(f"cached: {out} ({len(df)} rows, {df.index[0].date()} -> {df.index[-1].date()})")
        return

    sources = [args.source] if args.source != "auto" else ["yfinance", "stooq"]
    df, errors = None, []
    for name in sources:
        try:
            df = {"yfinance": fetch_yfinance, "stooq": fetch_stooq, "synthetic": fetch_synthetic}[
                name
            ](args.ticker, args.start, args.end)
            break
        except Exception as exc:  # noqa: BLE001 - report every source's failure
            errors.append(f"{name}: {exc}")
    if df is None:
        sys.exit("all sources failed:\n  " + "\n  ".join(errors))

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    df.to_csv(out)
    tag = " [SYNTHETIC DATA - not real prices]" if name == "synthetic" else ""
    print(
        f"saved: {out} ({len(df)} rows, {df.index[0].date()} -> {df.index[-1].date()},"
        f" source={name}){tag}"
    )


if __name__ == "__main__":
    main()
