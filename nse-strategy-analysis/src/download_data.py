"""Rebuild data/nifty50_15min.csv from the public 1-minute dataset.

Source: https://github.com/sandeepkapri/Nifty50-Minute-Data
(NIFTY 50 spot index, 1-minute OHLC, 2015-01-09 .. 2024-03-27)
"""
import os
import urllib.request

import pandas as pd

URL = ("https://raw.githubusercontent.com/sandeepkapri/Nifty50-Minute-Data/"
       "main/nifty50_candlestick_data.csv")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "nifty50_15min.csv")


def main():
    raw = "nifty50_1min.csv"
    if not os.path.exists(raw):
        print("downloading ~50 MB ...")
        urllib.request.urlretrieve(URL, raw)

    df = pd.read_csv(raw)
    df["dt"] = pd.to_datetime(df["Date"] + " " + df["Time"],
                              format="%d-%m-%Y %H:%M:%S")
    df = df.set_index("dt").sort_index()[["Open", "High", "Low", "Close"]]

    r = df.resample("15min").agg({"Open": "first", "High": "max",
                                  "Low": "min", "Close": "last"}).dropna()
    r = r.between_time("09:15", "15:25")          # regular session only
    sizes = r.groupby(r.index.date).size()
    keep = set(d for d, n in sizes.items() if n >= 20)  # drop muhurat etc.
    r = r[[d in keep for d in r.index.date]]
    r.index.name = "datetime"
    r.to_csv(OUT)
    print(f"wrote {OUT}: {len(r)} bars, {r.index.min()} .. {r.index.max()}")


if __name__ == "__main__":
    main()
