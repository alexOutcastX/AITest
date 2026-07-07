# NIFTY 50 Options Overlays — Black-Scholes Simulation Results

**Everything below is a model-based approximation.** There is no options-chain
data in this environment; every option price is Black-Scholes on the index
series with a *modelled* IV. Treat levels as indicative and rankings as more
reliable than absolute numbers. Read the model-risk section before believing
anything.

## Methodology

- **Data**: NIFTY 50 15-min bars 2015-01-09 → 2024-03-26 (`nifty50_15min.csv`).
  Option marks at daily granularity (daily close = last 15m close); 15m data
  drives the signal gates (EMA200 and Supertrend(14,3) sampled at each day's
  last bar).
- **Pricing**: European Black-Scholes, r = 6%, q = 1.2%. Strikes rounded to
  the 50-pt NIFTY grid.
- **IV model**: `IV_t = EWMA(span=20) realized vol of daily log returns
  (annualized), shifted 1 day (no lookahead) + vol-risk premium`, floored at
  10%. Premium sensitivity run at **+1 / +2.5 / +4 vol pts** (India VIX
  historically sits ~1–4 pts over realized; +2.5 is the "mid" case quoted in
  the text).
- **Cycles**: weekly = Thursday expiry (last trading day ≤ Thursday of the ISO
  week); monthly = last Thursday of the month. Entry at expiry-day **close**,
  7-day tenor, held to expiry, **settled at intrinsic using the actual index
  close** on expiry day. In between, positions are marked daily with BS (so
  maxDD includes intraweek mark-to-market pain, not just cycle-end P&L).
- **Costs**: 1.5 index pts per option leg per side (entry + settlement = 3
  pts/leg/cycle, charged even on legs expiring worthless, as an STT/friction
  proxy). Underlying: 1 pt per side, charged only when the underlying position
  changes.
- **Sizing**: everything is 1× index notional at cycle entry (cash-secured /
  unlevered). Idle cash earns **0%** — conservative for the put seller, who in
  reality would collect ~6% on the cash collateral (that alone is bigger than
  most of the option alpha below; see caveats).
- **Metrics**: CAGR and maxDD from the daily-marked equity curve; PF, win
  rate, worst cycle from per-cycle P&L. Periods: **2019–2024 primary**
  (weekly NIFTY options actually existed: launched Feb 2019), **2015–2018
  check** (weeklies are *synthetic* there — only monthlies traded).

Benchmarks on the same grids: index buy & hold (monthly grid) and
Supertrend(14,3) long-only in the underlying (weekly grid).

---

## Results — 2019–2024 (primary)

#### IV premium +1.0 vol pts

| strategy | CAGR% | maxDD% | PF | win% | worst_cycle% | cycles | sharpe |
|---|---|---|---|---|---|---|---|
| CSP 2% OTM (EMA200 gate) | 2.88 | -4.92 | 1.69 | 92.3 | -4.59 | 169 | 0.75 |
| CSP 3% OTM (EMA200 gate) | 1.70 | -4.64 | 1.70 | 59.2 | -3.83 | 169 | 0.60 |
| CSP 5% OTM (EMA200 gate) | 0.74 | -3.43 | 1.62 | 23.1 | -1.83 | 169 | 0.46 |
| CSP 2% OTM UNGATED | -0.65 | -26.76 | 0.97 | 90.5 | -12.18 | 273 | -0.05 |
| CSP 2% OTM (daily EMA200 gate) | 0.72 | -5.78 | 1.15 | 92.4 | -3.98 | 224 | 0.19 |
| CoveredCall 2% OTM (ST gate) | 11.32 | -17.97 | 1.74 | 59.6 | -6.53 | 151 | 1.08 |
| CoveredCall 3% OTM (ST gate) | 12.17 | -19.39 | 1.73 | 57.6 | -6.74 | 151 | 1.09 |
| ST(14,3) long-only underlying (weekly) | 8.90 | -22.25 | 1.50 | 55.0 | -6.88 | 151 | 0.72 |
| ProtPut idx + 5% OTM monthly put | 14.90 | -18.11 | 1.96 | 53.2 | -6.64 | 62 | 1.05 |
| Index buy&hold (monthly grid) | 15.50 | -34.31 | 1.87 | 53.2 | -25.53 | 62 | 0.91 |
| LongCall ATM weekly (ST gate) | -1.68 | -22.63 | 0.91 | 35.1 | -4.60 | 151 | -0.19 |
| BullPutSpread 2/5% (EMA200 gate) | 0.78 | -3.66 | 1.21 | 82.8 | -2.89 | 169 | 0.28 |

#### IV premium +2.5 vol pts (mid case)

| strategy | CAGR% | maxDD% | PF | win% | worst_cycle% | cycles | sharpe |
|---|---|---|---|---|---|---|---|
| CSP 2% OTM (EMA200 gate) | 4.42 | -4.46 | 2.08 | 92.3 | -4.53 | 169 | 1.12 |
| CSP 3% OTM (EMA200 gate) | 2.62 | -4.01 | 2.12 | 75.7 | -3.79 | 169 | 0.90 |
| CSP 5% OTM (EMA200 gate) | 1.05 | -2.61 | 1.94 | 30.2 | -1.82 | 169 | 0.64 |
| CSP 2% OTM UNGATED | 1.80 | -26.54 | 1.18 | 90.5 | -12.11 | 273 | 0.27 |
| CSP 2% OTM (daily EMA200 gate) | 2.60 | -4.44 | 1.52 | 92.4 | -3.92 | 224 | 0.64 |
| CoveredCall 2% OTM (ST gate) | 13.04 | -16.85 | 1.87 | 60.3 | -6.46 | 151 | 1.24 |
| CoveredCall 3% OTM (ST gate) | 13.29 | -18.73 | 1.80 | 58.9 | -6.69 | 151 | 1.19 |
| ST(14,3) long-only underlying (weekly) | 8.90 | -22.25 | 1.50 | 55.0 | -6.88 | 151 | 0.72 |
| ProtPut idx + 5% OTM monthly put | 13.89 | -18.67 | 1.88 | 53.2 | -6.79 | 62 | 1.00 |
| Index buy&hold (monthly grid) | 15.50 | -34.31 | 1.87 | 53.2 | -25.53 | 62 | 0.91 |
| LongCall ATM weekly (ST gate) | -3.84 | -24.30 | 0.80 | 35.1 | -4.67 | 151 | -0.50 |
| BullPutSpread 2/5% (EMA200 gate) | 1.98 | -2.98 | 1.54 | 90.5 | -2.85 | 169 | 0.69 |

#### IV premium +4.0 vol pts

| strategy | CAGR% | maxDD% | PF | win% | worst_cycle% | cycles | sharpe |
|---|---|---|---|---|---|---|---|
| CSP 2% OTM (EMA200 gate) | 6.19 | -4.40 | 2.54 | 92.3 | -4.47 | 169 | 1.53 |
| CSP 3% OTM (EMA200 gate) | 3.72 | -3.69 | 2.65 | 89.9 | -3.74 | 169 | 1.25 |
| CSP 5% OTM (EMA200 gate) | 1.43 | -2.25 | 2.37 | 37.3 | -1.80 | 169 | 0.85 |
| CSP 2% OTM UNGATED | 4.64 | -26.31 | 1.42 | 90.5 | -12.05 | 273 | 0.63 |
| CSP 2% OTM (daily EMA200 gate) | 4.82 | -4.11 | 1.98 | 92.4 | -3.87 | 224 | 1.15 |
| CoveredCall 2% OTM (ST gate) | 14.99 | -15.62 | 2.03 | 60.3 | -6.39 | 151 | 1.41 |
| CoveredCall 3% OTM (ST gate) | 14.62 | -17.95 | 1.90 | 58.9 | -6.65 | 151 | 1.30 |
| ST(14,3) long-only underlying (weekly) | 8.90 | -22.25 | 1.50 | 55.0 | -6.88 | 151 | 0.72 |
| ProtPut idx + 5% OTM monthly put | 12.73 | -19.29 | 1.79 | 53.2 | -6.93 | 62 | 0.93 |
| Index buy&hold (monthly grid) | 15.50 | -34.31 | 1.87 | 53.2 | -25.53 | 62 | 0.91 |
| LongCall ATM weekly (ST gate) | -6.10 | -29.26 | 0.69 | 33.8 | -4.75 | 151 | -0.82 |
| BullPutSpread 2/5% (EMA200 gate) | 3.32 | -2.82 | 1.92 | 91.7 | -2.80 | 169 | 1.14 |

## Results — 2015–2018 (check; weekly cycles are synthetic pre-Feb-2019)

#### IV premium +2.5 vol pts (mid case)

| strategy | CAGR% | maxDD% | PF | win% | worst_cycle% | cycles | sharpe |
|---|---|---|---|---|---|---|---|
| CSP 2% OTM (EMA200 gate) | 0.96 | -5.38 | 1.34 | 88.9 | -2.97 | 117 | 0.40 |
| CSP 3% OTM (EMA200 gate) | 0.04 | -4.68 | 1.03 | 53.0 | -1.90 | 117 | 0.03 |
| CSP 5% OTM (EMA200 gate) | -0.58 | -2.42 | 0.25 | 10.3 | -0.16 | 117 | -1.47 |
| CSP 2% OTM UNGATED | 0.80 | -6.87 | 1.15 | 87.9 | -3.45 | 206 | 0.20 |
| CSP 2% OTM (daily EMA200 gate) | -0.19 | -5.17 | 0.95 | 89.4 | -2.97 | 141 | -0.07 |
| CoveredCall 2% OTM (ST gate) | 4.16 | -12.53 | 1.27 | 60.2 | -4.98 | 108 | 0.55 |
| CoveredCall 3% OTM (ST gate) | 1.78 | -15.45 | 1.12 | 59.3 | -5.09 | 108 | 0.25 |
| ST(14,3) long-only underlying (weekly) | -0.51 | -21.87 | 1.00 | 57.4 | -5.10 | 108 | -0.02 |
| ProtPut idx + 5% OTM monthly put | 4.50 | -24.48 | 1.32 | 53.2 | -5.51 | 47 | 0.45 |
| Index buy&hold (monthly grid) | 5.02 | -22.96 | 1.34 | 55.3 | -7.71 | 47 | 0.44 |
| LongCall ATM weekly (ST gate) | -6.47 | -24.99 | 0.53 | 34.3 | -1.94 | 108 | -1.49 |
| BullPutSpread 2/5% (EMA200 gate) | -0.40 | -7.17 | 0.88 | 71.8 | -2.88 | 117 | -0.17 |

At +1.0 pt premium nearly every premium-selling strategy is ≤0 CAGR in
2015–2018 (CSP 2% gated −0.19%, bull put spread −1.40%); at +4.0 pts they
recover (CSP 2% gated +2.38%). **In the low-vol 2015–2018 regime the entire
edge of premium selling is the vol-risk-premium assumption itself.** 2019–2024
results are directionally robust across the premium range; 2015–2018 results
flip sign with it.

## March 2020 (COVID) window: 2020-02-15 → 2020-04-30

| strategy | ret% (+1) | ret% (+2.5) | ret% (+4) | maxDD% (+1) | maxDD% (+2.5) | maxDD% (+4) |
|---|---|---|---|---|---|---|
| CSP 2% OTM UNGATED | -11.42 | -10.72 | -10.00 | -26.76 | -26.54 | -26.31 |
| CSP 2% OTM (EMA200 gate) | 9.90 | 10.31 | 10.72 | -1.37 | -1.34 | -1.31 |
| CSP 2% OTM (daily EMA200 gate) | -1.46 | -1.34 | -1.23 | -1.75 | -1.69 | -1.64 |
| BullPutSpread 2/5% (EMA200 gate) | 1.86 | 1.96 | 2.05 | -1.73 | -1.72 | -1.70 |
| CoveredCall 2% OTM (ST gate) | 12.33 | 12.86 | 13.39 | -8.57 | -8.44 | -8.32 |
| LongCall ATM weekly (ST gate) | -7.00 | -7.46 | -7.91 | -12.83 | -13.05 | -13.28 |
| ProtPut idx + 5% OTM monthly put | -3.90 | -4.16 | -4.43 | -14.48 | -14.57 | -14.67 |
| Index buy&hold (monthly grid) | -16.70 | -16.70 | -16.70 | -32.99 | -32.99 | -32.99 |
| ST(14,3) long-only underlying (weekly) | 3.28 | 3.28 | 3.28 | -13.40 | -13.40 | -13.40 |

**The put seller's tail, honestly:** the ungated weekly put seller lost
−10 to −11% in ten weeks with a −26.5% drawdown — its worst single cycle
(Mar 12→19, index −14.2%) cost **−12.1%** of notional, wiping out roughly
*three years* of gated-CSP premium income in one week. The gated version's
**+10%** in the same window is a gate artifact, not put-selling skill: EMA200
on 15m bars ≈ an **8-day** EMA, and it flipped off on **Feb 20, 2020** —
before the crash — then re-entered in April selling puts at model IVs of
70–87%. The slower daily-EMA200 gate (a more honest trend filter) still dodged
most of it (−1.3%) because NIFTY broke its 200-DMA on Mar 2, before the worst
weeks — but nothing guarantees a gap-down through both the gate and the strike
next time. A single overnight −10% gap while the gate is on is a −8%-of-notional
cycle for the 2% OTM seller; the gate reduces frequency of tail exposure, not
its severity.

## Verdicts (mid case, +2.5 vol pts, 2019–2024)

1. **Cash-secured put selling (gated)** — *adds risk-adjusted return, not
   headline return.* CSP 2% OTM: 4.4% CAGR, −4.5% maxDD, PF 2.08, 92% win
   rate. That's a Sharpe ≈ 1.1 on fully-secured cash, but far below index
   CAGR — it is a cash-plus strategy, not an equity substitute (add ~6% T-bill
   yield on the collateral for the realistic total: ~10%). Farther strikes
   (3%, 5% OTM) earn less with proportionally less risk; 2% OTM is the best
   PF-per-CAGR here. **Ungated selling is uninvestable**: PF 1.18, −26.5%
   maxDD, March 2020 as above. The gate does all the tail work, and the 15m
   gate's COVID escape is partly luck.
2. **Covered call on Supertrend** — *the clearest winner.* 13.0% CAGR vs 8.9%
   for the same trend system without calls, maxDD −16.9% vs −22.3%, PF 1.87 vs
   1.50. Call premium more than paid for the foregone upside in every IV
   scenario and in both sample halves (2015–18: 4.2% vs −0.5%). Mechanically
   sensible: a trend gate already truncates the left tail; selling the right
   tail monetises the chop that hurts trend systems. 2% OTM ≈ 3% OTM; prefer
   2% for the higher premium haircut on whipsaw weeks.
3. **Protective put (monthly 5% OTM)** — *cheap disaster insurance, works as
   advertised.* Costs ~1.6 CAGR pts (15.5% → 13.9%) and cuts maxDD from
   −34.3% to −18.7%; in the COVID window −4.2% vs −16.7% for naked index, and
   worst monthly cycle −6.8% vs −25.5%. Hedge cost scales with the IV premium
   (12.7% CAGR at +4 pts) — and real skew makes 5% OTM puts *richer* than BS,
   so treat 1.6 pts as a lower bound on the true cost (realistically 2–3 pts).
4. **Long ATM weekly call as trend vehicle** — *does not work.* −3.8% CAGR,
   PF 0.80, 35% win rate; worse the higher the IV premium (−6.1% at +4 pts),
   and worse still in 2015–18 (−6.5%). Weekly ATM theta at NIFTY vol burns
   ~0.8–1% of notional per week; the Supertrend signal's edge per week is
   smaller than that. The defined-risk benefit shows up in COVID (−7% vs the
   ungated put seller's −11%) but you pay for it every single week. If you
   want defined risk on trend, buy the underlying and a put (see #3), don't
   roll weekly calls.
5. **Bull put spread 2%/5% (choice structure)** — *defined-risk put selling,
   modest but clean.* 2.0% CAGR, −3.0% maxDD, PF 1.54, 90% wins; worst cycle
   capped at −2.85% *by construction* (max loss ≈ 3% of spot minus credit),
   sailed through COVID at +2.0%. It gives up ~55% of the naked CSP's CAGR to
   cap the tail; unlike the CSP its safety does not depend on the trend gate
   firing in time. The honest defined-risk alternative to #1 — but note it
   went negative in 2015–18 at low IV premium: it needs the vol premium to
   exist.

## Model risk — read before using any number above

- **No real option prices anywhere.** All P&L is BS on modelled IV. The IV
  premium sweep (+1/+2.5/+4) brackets the average level of India VIX over
  realized, but real IV is dynamic: it spikes *before and during* crashes far
  faster than an EWMA of realized vol. Our marks lag reality in stress.
- **Flat IV — no skew.** NIFTY OTM puts trade ~2–4 vol pts *richer* than ATM.
  Direction of bias per strategy: **put sellers (CSP, bull-put short leg) earn
  more in reality** than shown (understated here); **protective-put and
  bull-put long legs cost more** (hedge cost understated, spread width credit
  roughly a wash since both legs are rich); **ATM call buyer/seller** roughly
  unbiased on skew but the buyer still loses the level premium. Net: CSP
  numbers are conservative, protective-put cost is optimistic, long-call is
  about right-to-optimistic.
- **Short-put maxDD is understated.** Marks use lagging EWMA vol; a real March
  2020 short put would have been marked at 60–90 VIX *during* the fall, not
  after. Intraweek margin calls / forced liquidation are not modelled — a real
  cash-secured seller survives, a leveraged one may not.
- **Weekly options did not exist before Feb 2019** (launched 2019-02-11);
  2015–2018 weekly results are synthetic. Monthly results there are fine.
  Also, NIFTY weekly expiry has been Thursday for almost the whole sample
  (moved only in 2025, after this data ends).
- **The trend-gate COVID escape is fragile.** Both gates happened to switch
  off before the worst weeks in 2020. A Kerviel-style overnight gap-down with
  the gate on is fully borne by the put seller. Do not size 2% OTM put selling
  as if −4.5% maxDD is the true tail; the true tail is the ungated table row.
- **Ignored**: idle-cash interest (understates CSP/spread returns by ~6%/yr on
  unused collateral — large), dividends on a real index holding vs futures
  basis, weekly expiry-day pin/gamma effects, bid-ask widening in stress
  (1.5 pts/leg is calm-market friction; March 2020 spreads were multiples of
  that), early unwind optimisation (all positions held to expiry).

Reproduce: `python3 options_sim.py` in this directory (writes
`results_raw.csv`, `covid_raw.csv`, prints all tables; ~20 s).
