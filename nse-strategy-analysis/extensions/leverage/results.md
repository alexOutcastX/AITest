# Position sizing / leverage optimization — NIFTY 50 combo strategy

Strategy under test: **ST(14,3) long-only + overnight long (last bar of day) when Close>EMA200**,
15-min bars 2015-01-09..2024-03-26, cost 0.025%/side unless noted.

**Carry assumption (applied to ALL leveraged results below):** index futures embed
cost-of-carry ≈ repo − dividends ≈ **+4.5%/yr drag on long notional vs spot**. Modeled
as `0.045/(252·25) × held` per bar on all long exposure (leverage-weighted). No extra
financing charge beyond that — SPAN margin funds the leverage, carry is the real cost.

Windows: OLD 2015-01-09..2019-03-27 · TRAIN 2019-03-27..2022-04-01 · TEST 2022-04-01..2024-03-27 · FULL.
Hard constraint: maxDD no worse than **−25% on every window**.

## 0. Baseline reproduction

| variant | OLD | TRAIN | TEST | FULL |
|---|---|---|---|---|
| combo ×1, no carry (as quoted) | 10.44% / −10.60% | 32.13% / −14.04% | 3.75% / −12.95% | **15.55% / −14.04%**, Sh 1.26, PF 1.55 |
| combo ×1, with 4.5%/yr carry | 7.79% / −11.49% | 28.85% / −14.51% | 1.30% / −14.81% | 12.76% / −14.81%, Sh 1.06 |

Carry costs ~2.8pp CAGR/yr (strategy is long ~62% of bars). Apples-to-apples comparisons
for futures implementation should use the with-carry row.

## 1. Volatility targeting — size = min(max_lev, target_vol / EWMA20_vol), vol shifted 1 day

CAGR% / maxDD% per window (carry included):

| target | cap | OLD | TRAIN | TEST | FULL | verdict |
|---|---|---|---|---|---|---|
| 10% | any | 7.1 / −9.2 | 13.7 / −7.8 | 4.8 / −11.0 | 8.7 / −11.0 | too timid |
| 15% | 2x | 10.4 / −13.5 | 20.9 / −11.5 | 6.5 / −16.2 | 12.9 / −16.2 | OK |
| 15% | 3x | 10.6 / −13.5 | 20.9 / −11.5 | 7.0 / −16.2 | 13.1 / −16.2 | OK |
| 20% | 2x | 12.4 / −17.7 | 27.8 / −14.9 | 5.5 / −20.9 | 15.7 / −20.9 | OK |
| **20%** | **3x** | **14.1 / −17.7** | **28.5 / −15.1** | **9.1 / −21.1** | **17.5 / −21.1** | **PICK** |
| 20% | 4x | 14.1 / −17.7 | 28.5 / −15.1 | 9.1 / −21.1 | 17.6 / −21.1 | cap>3 never binds |
| 25% | 3x | 16.7 / −21.8 | 36.5 / −18.7 | 9.3 / **−25.8** | 21.2 / −25.8 | **REJECT: TEST breaches −25%** |
| 25% | 4x | 17.5 / −21.8 | 36.4 / −18.7 | 11.2 / **−25.8** | 22.0 / −25.8 | REJECT |

Finer step: tv=21% → TEST DD −22.1; tv=22% → −23.0; tv=23% → −24.0. CAGR rises ~0.8pp per
step but the DD buffer to the −25% limit shrinks below 2pp — with 3x gap exposure and only
2 years of TEST data that margin is illusory. 20%/3x keeps ≈4pp buffer.

## 2. ATR-scaled sizing — size = min(cap, risk_budget / daily_ATR14%), ATR shifted 1 day

| risk_budget | cap | OLD | TRAIN | TEST | FULL | verdict |
|---|---|---|---|---|---|---|
| 1.0% | any | 7.1 / −10.7 | 15.7 / −9.5 | 4.5 / −12.3 | 9.3 / −12.3 | OK |
| 1.25% | 3x | 8.9 / −13.3 | 19.8 / −11.7 | 5.6 / −15.1 | 11.6 / −15.1 | OK |
| 1.5% | 3x | 10.6 / −15.8 | 24.1 / −13.9 | 6.6 / −17.9 | 14.0 / −17.9 | OK |
| 2.0% | 2x | 12.7 / −20.6 | 32.7 / −16.8 | 4.0 / −22.7 | 16.9 / −22.7 | OK |
| **2.0%** | **3x** | 14.1 / −20.6 | 32.9 / −18.2 | 8.6 / −23.3 | **18.7 / −23.3** | legal but only 1.7pp DD buffer |

ATR 2%/3x beats vol-target on raw FULL CAGR (18.7 vs 17.5) but is worse on every
risk measure: deeper DD in all windows, lower Sharpe (1.10 vs 1.16), lower TRAIN
ret/DD (1.80 vs 1.89), worst day −5.29% vs −4.75%, and it breaches −31% at 0.05% costs.
Vol targeting reacts faster to regime shifts (EWMA of squared returns vs ATR) — preferred.

## 3. Walk-forward Supertrend parameter check (2y train → 6m trade, step 6m, pick by ret_over_dd)

Grid (n,mult) ∈ {7,10,14,20}×{2.0,2.5,3.0,3.5} on the unlevered combo, cost 0.025%:

| trade window | picked (n,mult) | OOS CAGR% | OOS DD% |
|---|---|---|---|
| 2017-01→07 | 20, 3.5 | 22.2 | −2.3 |
| 2017-07→2018-01 | 20, 3.5 | 16.7 | −2.9 |
| 2018-01→07 | 10, 2.0 | 6.7 | −6.6 |
| 2018-07→2019-01 | 10, 2.0 | 5.0 | −11.9 |
| 2019-01→07 | 7, 3.0 | 23.5 | −3.9 |
| 2019-07→2020-01 | 7, 3.0 | 3.0 | −5.9 |
| 2020-01→07 | 7, 3.0 | 16.6 | −16.7 |
| 2020-07→2021-01 | 14, 2.5 | 75.8 | −2.7 |
| 2021-01→07 | 14, 2.5 | 29.4 | −4.5 |
| 2021-07→2022-01 | 20, 2.5 | 26.6 | −6.0 |
| 2022-01→07 | 20, 3.5 | −14.6 | −13.0 |
| 2022-07→2023-01 | 20, 2.5 | 5.1 | −8.4 |
| 2023-01→07 | 20, 2.5 | 8.2 | −6.0 |
| 2023-07→2024-01 | 20, 2.5 | 21.9 | −3.9 |
| 2024-01→03 | 20, 2.5 | −2.1 | −3.1 |

Stitched walk-forward (2017-01..2024-03): **CAGR 15.5%, maxDD −17.3%, Sharpe 1.20**
vs fixed ST(14,3) on the same period: **CAGR 18.1%, maxDD −14.0%, Sharpe 1.40**.

**Verdict: parameters are stable.** 13/15 OOS slices profitable; picked params wander
across the whole grid (7–20, 2.0–3.5) yet performance stays within ~85% of the fixed
choice's Sharpe. The performance surface is flat — ST(14,3) is not a lucky outlier, and
adaptive re-fitting adds nothing (it slightly underperforms from whipsaw around 2022).
Keep the fixed (14,3).

## 4. Drawdown throttle (halve size when equity >5% below peak, prior-bar signal)

| strategy | FULL CAGR% | FULL maxDD% | FULL r/DD |
|---|---|---|---|
| vol 20%/3x | 17.5 | −21.1 | 0.83 |
| vol 20%/3x + throttle | 12.8 | −15.8 | 0.81 |
| vol 25%/3x + throttle | 15.7 | −18.0 | 0.87 |
| atr 2%/3x | 18.7 | −23.3 | 0.80 |
| atr 2%/3x + throttle | 13.2 | −17.8 | 0.74 |

**Does not help.** The throttle reliably cuts DD ~5pp but costs 4–6pp CAGR — ret/DD is flat
to worse (the trend strategy's DDs typically precede its best recovery runs, so halving
size after a 5% dip sells exactly the rebound). Only the over-aggressive 25% variant sees
r/DD improve, and it still ends with less CAGR than plain 20%/3x. Rejected.

## 5. Cost sensitivity — FINAL strategy (vol-target 20%, cap 3x)

| cost/side | OLD | TRAIN | TEST | FULL | FULL Sharpe |
|---|---|---|---|---|---|
| 0.010% | 21.4 / −15.9 | 34.8 / −14.0 | 17.1 / −17.7 | 24.7 / −17.7 | 1.57 |
| 0.025% | 14.1 / −17.7 | 28.5 / −15.1 | 9.1 / −21.1 | 17.5 / −21.1 | 1.16 |
| 0.050% | 2.7 / −22.3 | 18.7 / −18.3 | −3.1 / **−27.5** | 6.4 / −27.5 | 0.48 |

High sensitivity: doubling friction to 0.05%/side destroys the edge AND breaches −25%
(leverage roughly 1.6x's the turnover: ~1.6 units/day). The strategy is only viable at
institutional-grade NIFTY futures friction (≤0.025%/side incl. slippage). Daily leverage
rebalancing should be batched with signal trades / use a rebalance band in live trading.

## FINAL RECOMMENDATION

**pos = combo(14,3) × min(3.0, 20% / σ̂)**, σ̂ = 20-day EWMA of daily returns, annualized,
lagged 1 day. Cap 3x (4x cap never binds — vol is never that low; 3x also keeps SPAN
margin utilization <60%). Code: `leverage.py`.

| window | CAGR% | maxDD% | Sharpe | PF | r/DD |
|---|---|---|---|---|---|
| OLD 2015–19 | 14.05 | −17.74 | 0.95 | 1.46 | 0.79 |
| TRAIN 2019–22 | 28.54 | −15.14 | 1.79 | 1.80 | 1.89 |
| TEST 2022–24 | 9.09 | −21.12 | 0.65 | 1.36 | 0.43 |
| **FULL 2015–24** | **17.54** | **−21.12** | **1.16** | **1.53** | 0.83 |

vs unlevered baseline FULL: 15.55% / −14.04% / Sh 1.26 / PF 1.55 (no carry), or
12.76% / −14.81% / Sh 1.06 with the same futures-carry model. On a consistent carry basis
the sizing adds **+4.8pp CAGR** for −6.3pp deeper DD; all windows respect −25%.

**Worst single day: −4.75% (2015-08-24, China-deval gap).** Next worst: −4.09% (2016-11-09
demonetization/US election), −3.90% (2016-06-24 Brexit). Notably the UNlevered baseline's
worst day is −7.96% (2020-03-23): vol targeting had already de-levered to <1x through the
COVID crash, so leverage here does not increase tail-day risk historically.

### Caveats (honest risks)
- **Gap risk is the real limit.** Mean leverage 1.61x, 24% of time ≥2x, 0.4% at the 3x cap.
  A repeat of the −13% 2020-03-23 index gap AT the 3x cap would be ≈ −39% in one bar —
  vol targeting mitigates (vol spikes before the worst gaps in this sample) but cannot
  prevent a first-gap-from-calm event. That is the scenario the −25% backtest DD does not show.
- Carry model is an approximation (constant 4.5%/yr; actual basis varies 3–6% and can
  compress in bear markets, which would flatter these results slightly).
- Sharpe FALLS vs unlevered quoted baseline (1.16 vs 1.26) — leverage buys CAGR, not quality.
- TEST-window edge is thin (9.1% CAGR, Sharpe 0.65): the underlying combo weakened
  after 2022; sizing cannot fix a fading signal.
- 0.05%/side friction kills it (6.4% CAGR, −27.5% DD): execution quality is load-bearing.
- Vol grid picked on TRAIN would choose the same cell (best TRAIN ret/DD among legal
  cells), so this is not test-set-fitted, but the −25% screen itself used all windows.
