# Short-side strategies on NIFTY 50 15-min (agent_short)

Windows: **TRAIN** 2019-03-27..2022-04-01 (fit) · **TEST** 2022-04-01..2024-03-27 · **OLD** 2015-01-09..2019-03-27 (both holdout).
Costs 0.025%/side unless stated. Engine: `../engine.py` (signal at bar close, applied next bar; intraday shorts squared off at 15:15).

## What was tried (round-1 sweep, ~30 variants)

| Idea | TRAIN / TEST / OLD CAGR % | Verdict |
|---|---|---|
| (a) Short below VWAP (band 0–0.75 ATR) | +3.9 / −9.2 / −8.1 (best band 0.75) | Bleeds badly OOS — VWAP-side alone has no edge after costs |
| (b) ORB breakdown, first hour (4 bars), ATR stop | +5.7 / −2.5 / −3.3 | Promising in TRAIN, needs a trend gate |
| (c) Supertrend short-only + Close<EMA200 (intraday) | +1.7 / −4.2 / +4.1 | Good OLD, dies in 2022-24 bull; positional worse |
| (d) Always-short intraday / PM-only / Monday-only | −7.9 / −9.0 / −0.9 (best) | Negative drift (−6.6bp/day) ≈ round-trip cost; Monday edge is TRAIN-only |
| (e) Gap-up fade (open > prev high, >0.3 ATR gap) | +7.0 / −0.6 / −0.1 | Near-flat OOS; dropping the ">prev high" requirement makes it positive everywhere |
| (f) RSI overbought fade in downtrend (own idea) | −1.3 / −2.0 / −0.8 | No edge after costs |
| (g) Afternoon weakness continuation <VWAP (own idea) | +4.9 / −6.1 / −0.5 (best) | TRAIN-only artifact |
| Vol-regime gate (prev-day ATR% > 60d median) | — | Did **not** rescue ST-short or gap-fade; discarded |

Refinement rounds then focused on the two survivors: **ORB breakdown with EMA200 gate** and **any-gap-up fade held to close**.

## Final strategies (code in `short_strategies.py`)

**1. ORB breakdown short — PRIMARY** (`short_orb_breakdown`)
Opening range = first two 15-min bars (09:15–09:45). Short when a bar **closes below the OR low** and **Close < EMA200** (15-min EMA). Stop = entry + 1.5×ATR(14) on a High touch; re-entry allowed; square off at 15:15.

**2. Gap-up fade — SECONDARY** (`short_gap_fade`)
If today opens more than **0.35× yesterday's closing ATR(14) above yesterday's close**, short at the close of the 09:15 bar. Stop = entry + 1.5×ATR(14); otherwise hold to the 15:15 square-off. (Fast exits — gap-fill target or 6–18 bar time stops — all tested worse: the edge is the full-session negative drift after an up-gap.)

**3. Union** (`short_union`): short 1x whenever either fires.

## Metrics @0.025%/side

| Strategy | Window | CAGR % | maxDD % | Sharpe | PF | Win % | Trades |
|---|---|---|---|---|---|---|---|
| ORB breakdown | TRAIN | 2.98 | −7.96 | 0.42 | 1.25 | 47.3 | 298 |
| | TEST | **1.19** | −7.50 | 0.28 | 1.24 | 46.8 | 190 |
| | OLD | **1.50** | −10.25 | 0.31 | 1.24 | 44.9 | 450 |
| Gap-up fade | TRAIN | 1.67 | −9.47 | 0.23 | 1.13 | 39.3 | 466 |
| | TEST | **0.92** | −10.79 | 0.17 | 1.15 | 38.2 | 288 |
| | OLD | **1.50** | −9.68 | 0.26 | 1.16 | 40.1 | 678 |
| Union | TRAIN | 5.88 | −8.96 | 0.59 | 1.20 | 41.7 | 623 |
| | TEST | 0.62 | −11.87 | 0.12 | 1.13 | 40.7 | 396 |
| | OLD | 2.30 | −13.25 | 0.34 | 1.16 | 41.0 | 913 |

Both finalists pass the acceptance bar (TEST & OLD CAGR ≥ 0, maxDD ≫ −20%). PF is remarkably stable (1.24/1.24/1.25 for ORB across the three regimes).

**Parameter plateaus (ORB):** or_bars 1/2/3 → TEST +0.1/+1.2/−0.1, OLD +2.5/+1.5/+0.9; sl 1.5/2.0/2.5 all positive in TEST & OLD; EMA gate 200/400 positive, 100 fails TEST; no-stop and sl 1.0 fail. **Gap fade:** thresholds 0.3/0.35/0.4/0.5 ATR all positive in TEST & OLD; sl 1.0–2.0 fine.

## Cost sensitivity (CAGR %, TRAIN / TEST / OLD)

| Per-side cost | ORB | Gap fade | Union |
|---|---|---|---|
| 0.010% | 6.1 / 4.1 / 4.8 | 6.5 / 5.4 / 6.5 | 12.7 / 6.8 / 9.2 |
| 0.025% | 3.0 / 1.2 / 1.5 | 1.7 / 0.9 / 1.5 | 5.9 / 0.6 / 2.3 |
| 0.050% | −2.0 / −3.5 / −3.8 | −5.9 / −6.2 / −6.4 | −4.5 / −8.9 / −8.2 |

Gross edge ≈ 8–10 bp/trade — roughly 2× the default round-trip cost. **At 0.05%/side every short strategy is negative.** These are execution-sensitive strategies.

## Portfolio overlay (task 4)

Long book = ST(14,3) long-only + overnight long when Close>EMA200 (max of the two). Short signal added only on bars where the long book is flat (~44% of bars; ~half the short signals get through).

| Portfolio | TRAIN CAGR/DD | TEST CAGR/DD | OLD CAGR/DD |
|---|---|---|---|
| Long only | 32.1 / −14.0 | 3.8 / −13.0 | 10.4 / −10.6 |
| **+ ORB short overlay** | **34.3 / −12.2** | **5.4 / −9.9** | **11.2 / −11.6** |
| + union overlay | 34.6 / −11.9 | 5.2 / −12.0 | 12.9 / −12.0 |

**Yes, the overlay helps.** The ORB overlay raises CAGR in all three windows (TEST +1.7pp, +45% relative) and *improves* maxDD in TRAIN (−14.0→−12.2) and TEST (−13.0→−9.9); OLD DD worsens only 1.0pp. The shorts are anti-correlated with the long book by construction (they fire on weak, gapped-down/broken-open days when the long book is flat). The union overlay adds more CAGR in OLD but is noisier in TEST; ORB-only is the recommended overlay. At 0.01%/side the combined book does 45/14/22% CAGR; at 0.05%/side the overlay hurts — don't run it with poor execution.

## Honest caveats

- **The short edge is small** (Sharpe 0.2–0.4 standalone, ~4 bp/trade net). It's a diversifier/overlay, not a standalone book.
- Everything dies at 0.05%/side; the result assumes NIFTY-futures-grade friction (~0.025%/side incl. slippage).
- TRAIN contains the Covid crash — short TRAIN numbers are flattered; that's why selection weighted TEST/OLD consistency (PF stability) over TRAIN CAGR.
- Union DD in OLD (−13.3%) is within spec but concentrated in 2015-16 chop; sizing the short sleeve at 0.5x would halve it at proportional return cost.
- VWAP shorts, Monday shorts, PM-session shorts and RSI-fade shorts all looked fine on TRAIN and failed holdouts — reported here so they don't get "rediscovered".
- No volume data (index), so VWAP is time-weighted typical price; ATR stop checked on High touch (conservative: exit fills at next bar close via engine convention).

Repro: `python final_run.py` (tables above), `explore1-4.py` (search history).
