---
name: trading-strategy-backtester
description: >
  Backtest stock trading strategies and build quantitative models. Use when the user
  wants to test a trading idea (e.g. "backtest a 50/200 SMA crossover on AAPL"),
  compare strategies, compute risk/return metrics (Sharpe, Sortino, max drawdown,
  VaR), fetch historical market data, or run parameter optimization / walk-forward
  analysis. Triggers on: backtest, trading strategy, moving average crossover, RSI,
  MACD, Bollinger, momentum, quant, Sharpe ratio, drawdown, stock model.
---

# Trading Strategy Backtester

Research-grade backtesting of rule-based trading strategies on daily OHLCV data.
Everything runs locally with pandas/numpy. **This skill never places real trades.**

## Workflow

Follow these steps in order:

### 1. Clarify the request (only if genuinely ambiguous)

You need: ticker(s), strategy rules, date range, and starting capital assumption.
Apply sensible defaults instead of asking: 10 years of history (or max available),
long-only, 100% of equity per position, 5 bps commission + 5 bps slippage per side.
State the defaults you assumed in the final report.

### 2. Install dependencies (first run only)

```bash
pip install --quiet pandas numpy yfinance
```

`matplotlib` is optional — install it only if the user wants a chart.

### 3. Fetch data

```bash
python3 scripts/fetch_data.py AAPL --start 2015-01-01 --out data/AAPL.csv
```

- Tries Yahoo Finance (via `yfinance`) first, falls back to Stooq automatically.
- Data is cached in `data/` — re-running is cheap. Use `--force` to refresh.
- If the machine has no market-data access, use `--source synthetic` so the user
  can still exercise the pipeline, and **tell the user the data is synthetic**.

### 4. Run the backtest

Built-in strategies (see `scripts/strategies.py` for the registry and parameters):

| Strategy       | Idea                                   | Key params                        |
|----------------|----------------------------------------|-----------------------------------|
| `buy_hold`     | Benchmark: always long                 | —                                 |
| `sma_cross`    | Golden/death cross trend following     | `fast=50, slow=200, allow_short`  |
| `ema_cross`    | EMA variant of the above               | `fast=12, slow=26, allow_short`   |
| `rsi_reversal` | Mean reversion: buy oversold           | `period=14, lower=30, upper=70`   |
| `macd`         | MACD line vs signal line               | `fast=12, slow=26, signal=9`      |
| `bollinger`    | Mean reversion at the bands            | `period=20, num_std=2`            |
| `momentum`     | Time-series momentum (trailing return) | `lookback=126, allow_short`       |

```bash
python3 scripts/backtest.py --data data/AAPL.csv --strategy sma_cross --params fast=50,slow=200
```

Useful flags: `--capital 10000`, `--commission-bps 5`, `--slippage-bps 5`,
`--json report.json`, `--equity-csv equity.csv`, `--start/--end` to slice dates.

The report always includes a buy-and-hold benchmark on the same data and costs.

### 5. Custom strategies

If the user's rules don't map to a built-in, write a small Python file that defines
`strategy(df, **params) -> pd.Series` (values in [-1, 1] = target position for the
**next** bar; the engine shifts by one bar so you must NOT shift yourself) and pass
it with `--strategy-file my_strategy.py`. `df` has columns
`Open, High, Low, Close, Volume` and a DatetimeIndex. Reuse the indicator helpers
importable from `strategies.py` (`sma`, `ema`, `rsi`, `macd_lines`,
`bollinger_bands`).

### 6. Parameter optimization (only when asked)

```bash
python3 scripts/backtest.py --data data/AAPL.csv --strategy sma_cross \
  --optimize "fast=10:100:10,slow=100:300:25" --oos-split 0.3
```

Grid-search on the first 70% (train), validates the best parameters on the held-out
30% (test). **Always report both train and test metrics** and warn that a large gap
means the parameters are overfit.

### 7. Report results

Lead with the headline: strategy vs buy-and-hold total return and Sharpe. Then the
metrics table, trade stats, and assumptions (costs, date range, data source).
Always include these caveats, briefly:

- Past performance does not predict future results; this is research, not advice.
- Single-ticker backtests carry survivorship/selection bias.
- Results assume the stated costs and daily-close fills; real execution differs.
- Optimized parameters are prone to overfitting — trust out-of-sample numbers.

For metric definitions and interpretation thresholds, read
[references/metrics.md](references/metrics.md) — consult it when the user asks what
a number means or whether it is "good".

## Guardrails

- Never claim a strategy "works" or "is profitable" — report numbers and caveats.
- Never look ahead: positions are always lagged one bar by the engine; don't
  bypass it.
- Refuse requests to connect to live brokerage APIs to place orders from this
  skill; it is a research tool.
- `data/`, `*.csv`, and generated reports should not be committed unless the user
  asks.
