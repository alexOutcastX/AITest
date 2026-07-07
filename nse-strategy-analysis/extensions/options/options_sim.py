"""Black-Scholes options overlay simulator for NIFTY 50 (15-min index data).

NO options-chain data exists here: every option price is a Black-Scholes
approximation off the index series with a modelled IV
    IV = EWMA-20d realized vol (annualized, shifted 1 day  -> no lookahead)
         + vol risk premium (sensitivity: +1 / +2.5 / +4 vol pts), floored at 10%.
Flat IV per (date) -- no skew, no smile, no vol-of-vol. See results.md for the
direction of each bias. Results are model-based approximations, not tradeable
history.

Cycles:  weekly  = Thursday expiries (last trading day <= Thursday of the week)
         monthly = last Thursday of the month (last trading day <= it)
Entry on expiry-day close, hold to next expiry, settle at INTRINSIC using the
actual index close on expiry day. Daily BS mark-to-market in between (so maxDD
captures intraweek pain, e.g. March 2020).

Costs:   1.5 index points per OPTION leg per side (entry + settle = 3 pts/leg
         per cycle; a leg that expires worthless is still charged the exit side
         as an STT/friction proxy).  Underlying leg: 1.0 pt per side, charged
         only when the underlying position actually changes.

r = 6%, q = 1.2%.  All strategy P&L is expressed as return on 1x index
notional at cycle entry (cash-secured / unlevered; idle cash earns 0 --
conservative for the put seller, who would really collect T-bill interest).
"""
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import engine as E  # noqa: E402

R, Q = 0.06, 0.012
OPT_COST = 1.5          # index pts per option leg per side
UND_COST = 1.0          # index pts per underlying side
IV_FLOOR = 0.10
IV_PREMIA = [0.01, 0.025, 0.04]   # +1 / +2.5 / +4 vol pts over realized

_erf = np.frompyfunc(math.erf, 1, 1)

def _N(x):
    e = _erf(np.asarray(x, dtype=float) / math.sqrt(2.0))
    return 0.5 * (1.0 + np.asarray(e, dtype=float))

def bs_price(S, K, T, iv, kind, r=R, q=Q):
    """European BS price. At T<=0 returns intrinsic."""
    S, K, T, iv = map(np.asarray, (S, K, T, iv))
    T = np.maximum(T, 0.0)
    intrinsic = np.maximum(S - K, 0.0) if kind == "call" else np.maximum(K - S, 0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        sq = iv * np.sqrt(T)
        d1 = (np.log(S / K) + (r - q + 0.5 * iv ** 2) * T) / sq
        d2 = d1 - sq
        if kind == "call":
            v = S * np.exp(-q * T) * _N(d1) - K * np.exp(-r * T) * _N(d2)
        else:
            v = K * np.exp(-r * T) * _N(-d2) - S * np.exp(-q * T) * _N(-d1)
    return np.where(T > 0, v, intrinsic)


# ---------------------------------------------------------------- data layer

def load(csv=HERE.parent / "nifty50_15min.csv"):
    df = pd.read_csv(csv, index_col=0, parse_dates=True).sort_index()
    daily = df.groupby(df.index.normalize()).agg(
        Open=("Open", "first"), High=("High", "max"),
        Low=("Low", "min"), Close=("Close", "last"))
    # realized vol: EWMA(span=20) of daily log returns, annualized, SHIFTED 1d
    lr = np.log(daily.Close).diff()
    rv = lr.ewm(span=20, adjust=False).std() * math.sqrt(252)
    daily["rv20"] = rv.shift(1)
    # 15m signals sampled at each day's LAST bar (known at that day's close)
    last_bar = df.groupby(df.index.normalize()).tail(1)
    idx = last_bar.index.normalize()
    daily["ema200_gate"] = pd.Series(
        (last_bar.Close > E.ema(df.Close, 200).loc[last_bar.index]).values, index=idx)
    daily["st_dir"] = pd.Series(
        E.supertrend(df, 14, 3.0).loc[last_bar.index].values, index=idx)
    # slower, conventional trend gate: 200-DAY EMA of daily closes
    daily["ema200d_gate"] = daily.Close > daily.Close.ewm(span=200, adjust=False).mean()
    return df, daily


def weekly_expiries(dates):
    """Last trading day <= Thursday, per ISO week."""
    s = pd.Series(dates, index=dates)
    iso = dates.isocalendar()
    key = iso["year"].astype(int) * 100 + iso["week"].astype(int)
    out = []
    for _, wk in s.groupby(key.values):
        cand = wk[wk.index.weekday <= 3]
        if len(cand):
            out.append(cand.index.max())
    return sorted(out)

def monthly_expiries(dates):
    """Last trading day <= last Thursday of each month."""
    out = []
    for _, mo in pd.Series(dates, index=dates).groupby([dates.year, dates.month]):
        thursdays = mo[mo.index.weekday == 3]
        if len(thursdays):
            out.append(thursdays.index.max())
        else:                                   # Thursday-less tail: last day <= would-be Thu
            out.append(mo.index.max())
    return sorted(out)


def round_strike(k):
    return round(k / 50.0) * 50.0


# ---------------------------------------------------------- cycle simulator

def simulate(daily, expiries, leg_fn, iv_prem, start, end):
    """Generic cycle engine.

    leg_fn(t0, S0, row) -> (option_legs, und_qty) or None to sit out the cycle.
      option_legs: list of (kind, strike, qty); qty>0 long, qty<0 short.
      und_qty: underlying position held during the cycle (0/1).
    Returns dict with daily return series (on entry notional) + cycle records.
    """
    dates = daily.index
    exp = [e for e in expiries if start <= e <= end]
    day_ret = {}
    cycles = []
    prev_und = 0.0
    for t0, t1 in zip(exp[:-1], exp[1:]):
        row = daily.loc[t0]
        S0 = row.Close
        spec = leg_fn(t0, S0, row)
        legs, und = ([], 0.0) if spec is None else spec
        span = dates[(dates > t0) & (dates <= t1)]
        if not len(span):
            continue
        T0 = (t1 - t0).days / 365.0
        iv0 = max(row.rv20 + iv_prem, IV_FLOOR)
        entry_px = {i: float(bs_price(S0, k, T0, iv0, kind))
                    for i, (kind, k, q) in enumerate(legs)}
        cost = OPT_COST * sum(abs(q) for _, _, q in legs) * 2   # entry+settle
        cost += UND_COST * abs(und - prev_und)                  # underlying turnover
        pnl_opt = 0.0
        prev_val = dict(entry_px)
        prev_S = S0
        n_days = len(span)
        for j, d in enumerate(span):
            Sd = daily.Close.loc[d]
            Td = (t1 - d).days / 365.0
            ivd = max(daily.rv20.loc[d] + iv_prem, IV_FLOOR)
            dpnl = und * (Sd - prev_S)
            for i, (kind, k, q) in enumerate(legs):
                v = float(bs_price(Sd, k, Td, ivd, kind))       # intrinsic at expiry
                dpnl += q * (v - prev_val[i])
                prev_val[i] = v
            if j == 0:
                dpnl -= cost                                    # charge all friction up front
            pnl_opt += dpnl
            day_ret[d] = day_ret.get(d, 0.0) + dpnl / S0
            prev_S = Sd
        # settle-side underlying cost when signal will drop is charged next cycle via |und-prev|
        prev_und = und
        cycles.append({"t0": t0, "t1": t1, "S0": S0, "ret": pnl_opt / S0,
                       "active": spec is not None, "n_legs": len(legs)})
    if prev_und:                                                # close underlying at sample end
        d = cycles[-1]["t1"]
        day_ret[d] = day_ret.get(d, 0.0) - UND_COST / cycles[-1]["S0"]
    dr = pd.Series(day_ret).sort_index()
    dr = dr.reindex(dates[(dates > exp[0]) & (dates <= exp[-1])]).fillna(0.0)
    return {"daily": dr, "cycles": pd.DataFrame(cycles)}


# ---------------------------------------------------------------- metrics

def metrics(res, label):
    dr, cyc = res["daily"], res["cycles"]
    eq = (1 + dr).cumprod()
    yrs = (dr.index[-1] - dr.index[0]).days / 365.25
    cagr = eq.iloc[-1] ** (1 / yrs) - 1
    dd = (eq / eq.cummax() - 1).min()
    act = cyc[cyc.active]
    r = act.ret
    wins, losses = r[r > 0], r[r < 0]
    pf = wins.sum() / abs(losses.sum()) if len(losses) and losses.sum() != 0 else float("inf")
    return {"strategy": label,
            "CAGR%": round(100 * cagr, 2),
            "maxDD%": round(100 * dd, 2),
            "PF": round(pf, 2),
            "win%": round(100 * len(wins) / len(r), 1) if len(r) else np.nan,
            "worst_cycle%": round(100 * r.min(), 2) if len(r) else np.nan,
            "cycles": len(act),
            "sharpe": round(dr.mean() / dr.std() * math.sqrt(252), 2) if dr.std() > 0 else np.nan}

def window_pnl(res, a, b):
    """Cumulative return and maxDD inside [a, b] (for the COVID window)."""
    dr = res["daily"].loc[a:b]
    if not len(dr):
        return np.nan, np.nan
    eq = (1 + dr).cumprod()
    return round(100 * (eq.iloc[-1] - 1), 2), round(100 * (eq / eq.cummax() - 1).min(), 2)


# ---------------------------------------------------------------- strategies

def make_strategies(daily):
    S = {}
    # 1. cash-secured weekly put selling, gated by 15m Close>EMA200
    for otm in (0.02, 0.03, 0.05):
        def f(t0, S0, row, otm=otm):
            if not row.ema200_gate:
                return None
            return [("put", round_strike(S0 * (1 - otm)), -1.0)], 0.0
        S[f"CSP {int(otm*100)}% OTM (EMA200 gate)"] = ("W", f)
    # ungated variant for reference (must show the March-2020 tail)
    S["CSP 2% OTM UNGATED"] = ("W", lambda t0, S0, row:
                               ([("put", round_strike(S0 * 0.98), -1.0)], 0.0))
    # slower daily-EMA200 gate: the 15m EMA200 is ~an 8-DAY ema, i.e. a fast
    # gate that happened to sidestep COVID entirely -- show a slow-gate variant
    S["CSP 2% OTM (daily EMA200 gate)"] = ("W", lambda t0, S0, row:
        None if not row.ema200d_gate else
        ([("put", round_strike(S0 * 0.98), -1.0)], 0.0))
    # 2. covered call on Supertrend(14,3) long system
    for otm in (0.02, 0.03):
        def f(t0, S0, row, otm=otm):
            if row.st_dir <= 0:
                return None
            return [("call", round_strike(S0 * (1 + otm)), -1.0)], 1.0
        S[f"CoveredCall {int(otm*100)}% OTM (ST gate)"] = ("W", f)
    S["ST(14,3) long-only underlying (weekly)"] = ("W", lambda t0, S0, row:
        None if row.st_dir <= 0 else ([], 1.0))
    # 3. protective put: long index + 5% OTM monthly put
    S["ProtPut idx + 5% OTM monthly put"] = ("M", lambda t0, S0, row:
        ([("put", round_strike(S0 * 0.95), 1.0)], 1.0))
    S["Index buy&hold (monthly grid)"] = ("M", lambda t0, S0, row: ([], 1.0))
    # 4. long ~ATM weekly call as defined-risk trend following
    S["LongCall ATM weekly (ST gate)"] = ("W", lambda t0, S0, row:
        None if row.st_dir <= 0 else ([("call", round_strike(S0), 1.0)], 0.0))
    # 5. choice: bull put spread (short 2% OTM / long 5% OTM) in EMA200 uptrend
    S["BullPutSpread 2/5% (EMA200 gate)"] = ("W", lambda t0, S0, row:
        None if not row.ema200_gate else
        ([("put", round_strike(S0 * 0.98), -1.0), ("put", round_strike(S0 * 0.95), 1.0)], 0.0))
    return S


def run_all():
    df, daily = load()
    wexp = weekly_expiries(daily.index)
    mexp = monthly_expiries(daily.index)
    strategies = make_strategies(daily)
    periods = {"2019-2024 (primary)": (pd.Timestamp("2019-01-01"), daily.index[-1]),
               "2015-2018 (check)":   (daily.index[0], pd.Timestamp("2018-12-31"))}
    out_rows, covid_rows = [], []
    for pname, (a, b) in periods.items():
        for prem in IV_PREMIA:
            for label, (freq, fn) in strategies.items():
                res = simulate(daily, wexp if freq == "W" else mexp, fn, prem, a, b)
                m = metrics(res, label)
                m.update(period=pname, iv_prem=f"+{prem*100:g}")
                out_rows.append(m)
                if pname.startswith("2019"):
                    c, cd = window_pnl(res, "2020-02-15", "2020-04-30")
                    covid_rows.append({"strategy": label, "iv_prem": f"+{prem*100:g}",
                                       "covid_ret%": c, "covid_maxDD%": cd})
    res_df = pd.DataFrame(out_rows)
    covid_df = pd.DataFrame(covid_rows)
    return res_df, covid_df, daily


if __name__ == "__main__":
    pd.set_option("display.width", 250)
    res, covid, daily = run_all()
    for p in res.period.unique():
        for prem in res.iv_prem.unique():
            sub = res[(res.period == p) & (res.iv_prem == prem)].drop(columns=["period", "iv_prem"])
            print(f"\n### {p}  |  IV = rv20 {prem} vol pts\n")
            print(sub.to_string(index=False))
    print("\n### COVID window 2020-02-15..2020-04-30 (2019-2024 runs)\n")
    print(covid.pivot(index="strategy", columns="iv_prem",
                      values=["covid_ret%", "covid_maxDD%"]).to_string())
    res.to_csv(HERE / "results_raw.csv", index=False)
    covid.to_csv(HERE / "covid_raw.csv", index=False)
