# Metric definitions and how to read them

All metrics are computed on daily net returns (after commission + slippage),
annualized with 252 trading days, risk-free rate assumed 0.

| Metric | Definition | Rule of thumb (daily equities) |
|---|---|---|
| Total return | Final equity / starting capital − 1 | Compare vs buy & hold, not vs zero |
| CAGR | Geometric annual growth rate | Meaningless on < ~3 years of data |
| Volatility | Std-dev of daily returns × √252 | Single stocks ~20–40%; strategies should be lower if they hold cash |
| Sharpe | Mean daily return / std-dev × √252 | < 0.5 weak · 0.5–1 decent · 1–2 good · > 2 suspicious (check for bugs/overfit) |
| Sortino | Like Sharpe but only downside deviation in the denominator | Same scale as Sharpe; higher when losses are rare but gains are lumpy |
| Max drawdown | Worst peak-to-trough equity decline | Investors abandon strategies around −20–30%; > −50% is usually untradable |
| Calmar | CAGR / \|max drawdown\| | > 0.5 decent, > 1 good on multi-year tests |
| Daily VaR 95% | 5th percentile of daily returns while in a position | "On the worst 1-in-20 day expect to lose at least this much" |
| Exposure | % of bars with a nonzero position | Low exposure + high Sharpe can just mean few lucky trades |
| Win rate | % of round-trip trades with positive P&L | Trend followers are often < 50% and still profitable — read with avg trade |
| Profit factor | Gross wins / gross losses | > 1.5 decent; exactly ∞ means there were no losing trades (tiny sample!) |

## Interpretation caveats to repeat to the user

- **Sample size**: fewer than ~30 trades or ~3 years of data → every metric is
  noise. Say so explicitly.
- **Costs dominate fast strategies**: if turnover is high, rerun with doubled
  commission/slippage and show the difference.
- **Overfitting**: any parameter that was tuned on the same data it is judged on
  inflates Sharpe. Only out-of-sample metrics count as evidence.
- **Benchmark honestly**: a long-only stock strategy in a bull market almost
  always looks good in absolute terms — the buy & hold column is the real bar.
- **Adjusted prices**: Yahoo data is split/dividend adjusted (total return);
  Stooq is split-adjusted. Mixing sources across runs changes results slightly.
