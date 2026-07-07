"""Report charts for the NSE 15-min strategy analysis (light-mode PNGs)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import pandas as pd, numpy as np
import engine as E

# --- palette (validated reference instance, light mode) ---
SURFACE = "#fcfcfb"; PAGE = "#f9f9f7"
INK = "#0b0b0b"; INK2 = "#52514e"; MUTED = "#898781"
GRID = "#e1e0d9"; BASE = "#c3c2b7"
S1, S2, S3, S4 = "#2a78d6", "#1baf7a", "#eda100", "#4a3aa7"  # blue aqua yellow violet
RED, BLUE = "#e34948", "#2a78d6"

plt.rcParams.update({
    "figure.facecolor": PAGE, "axes.facecolor": SURFACE,
    "axes.edgecolor": BASE, "axes.labelcolor": INK2,
    "xtick.color": MUTED, "ytick.color": MUTED,
    "grid.color": GRID, "grid.linewidth": 0.8,
    "font.family": "sans-serif", "font.size": 10,
    "axes.titlecolor": INK, "axes.titlesize": 12, "axes.titleweight": "bold",
    "axes.spines.top": False, "axes.spines.right": False,
})

full = pd.read_csv("nifty50_15min.csv", index_col=0, parse_dates=True)

def strat_overnight(df, trend=None):
    idx = df.index
    is_last = pd.Series(idx, index=idx).groupby(idx.normalize()).transform("max") == idx
    pos = pd.Series(0.0, index=idx); pos[is_last.values] = 1
    if trend: pos[df.Close <= E.ema(df.Close, trend)] = 0
    return pos

def strat_combo(df):
    base = E.strat_supertrend(df, 14, 3.0, allow_short=False)
    return pd.concat([base, strat_overnight(df, 200)], axis=1).max(axis=1)

def strat_ensemble(df):
    return (E.strat_st_ema(df,10,3.0,200) + E.strat_st_ema(df,20,2.5,100)
            + E.strat_supertrend(df,14,3.0,allow_short=False)) / 3.0

runs = {
    "Buy & hold":            None,
    "ST(14,3) long + overnight": strat_combo(full),
    "Overnight > EMA200":    strat_overnight(full, 200),
    "Ensemble (3 systems)":  strat_ensemble(full),
}
eqs = {}
for name, pos in runs.items():
    if pos is None:
        eqs[name] = full.Close / full.Close.iloc[0]
    else:
        eqs[name] = E.run(full, pos)["eq"]

daily = {n: e.groupby(e.index.normalize()).last() for n, e in eqs.items()}
colors = {"Buy & hold": MUTED, "ST(14,3) long + overnight": S1,
          "Overnight > EMA200": S2, "Ensemble (3 systems)": S4}

# ---- 1. equity curves ----
fig, ax = plt.subplots(figsize=(10, 5.4), dpi=150)
for name, e in daily.items():
    lw = 1.6 if name == "Buy & hold" else 2.0
    ax.plot(e.index, e.values, color=colors[name], lw=lw, label=name,
            zorder=2 if name == "Buy & hold" else 3)
    ax.annotate(f" {name}  {e.iloc[-1]:.1f}x", (e.index[-1], e.iloc[-1]),
                color=colors[name], fontsize=9, fontweight="bold", va="center")
ax.set_title("NIFTY 50, 15-min strategies — growth of ₹1 (2015–2024, net of costs)")
ax.grid(axis="y"); ax.set_xlim(daily["Buy & hold"].index[0], daily["Buy & hold"].index[-1] + pd.Timedelta(days=780))
ax.legend(frameon=False, loc="upper left", labelcolor=INK2)
ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
fig.tight_layout(); fig.savefig("chart_equity.png", facecolor=PAGE); plt.close(fig)

# ---- 2. drawdown ----
fig, ax = plt.subplots(figsize=(10, 3.6), dpi=150)
for name in ["Buy & hold", "ST(14,3) long + overnight", "Overnight > EMA200"]:
    e = daily[name]
    dd = (e / e.cummax() - 1) * 100
    ax.plot(dd.index, dd.values, color=colors[name], lw=1.8, label=name)
ax.set_title("Drawdown from peak (%)")
ax.grid(axis="y"); ax.legend(frameon=False, loc="lower right", labelcolor=INK2)
ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
fig.tight_layout(); fig.savefig("chart_drawdown.png", facecolor=PAGE); plt.close(fig)

# ---- 3. overnight vs intraday decomposition ----
d5 = full[full.index >= "2019-03-27"]
day_open = d5.Open.groupby(d5.index.normalize()).first()
day_close = d5.Close.groupby(d5.index.normalize()).last()
gap = (day_open / day_close.shift() - 1).fillna(0)
intr = day_close / day_open - 1
fig, ax = plt.subplots(figsize=(10, 4.6), dpi=150)
ax.plot(gap.index, (1 + gap).cumprod(), color=S1, lw=2, label="Overnight only (close → next open)")
ax.plot(intr.index, (1 + intr).cumprod(), color=RED, lw=2, label="Intraday only (open → close)")
ax.plot(day_close.index, day_close / day_close.iloc[0], color=MUTED, lw=1.6, label="NIFTY 50 buy & hold")
ax.axhline(1, color=BASE, lw=1)
ax.annotate(" +358%", (gap.index[-1], (1+gap).cumprod().iloc[-1]), color=S1, fontweight="bold")
ax.annotate(" −58%", (intr.index[-1], (1+intr).cumprod().iloc[-1]), color=RED, fontweight="bold")
ax.set_title("Where NIFTY's return actually comes from (2019–2024): overnight gaps, not the session")
ax.grid(axis="y"); ax.legend(frameon=False, loc="upper left", labelcolor=INK2)
ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
fig.tight_layout(); fig.savefig("chart_overnight.png", facecolor=PAGE); plt.close(fig)

# ---- 4. time-of-day profile (diverging bars) ----
ret = d5.Close.pct_change()
same_day = d5.index.normalize() == pd.Series(d5.index, index=d5.index).shift().dt.normalize()
ir = ret[same_day.values]
prof = ir.groupby(ir.index.time).mean() * 1e4
labels = [t.strftime("%H:%M") for t in prof.index]
fig, ax = plt.subplots(figsize=(10, 4.2), dpi=150)
cols = [S1 if v >= 0 else RED for v in prof.values]
ax.bar(labels, prof.values, color=cols, width=0.72)
ax.axhline(0, color=BASE, lw=1)
ax.set_title("Average 15-min bar return by time of day (bps, 2019–2024)")
ax.set_ylabel("bps"); ax.grid(axis="y")
plt.setp(ax.get_xticklabels(), rotation=45, ha="right", fontsize=8)
fig.tight_layout(); fig.savefig("chart_timeofday.png", facecolor=PAGE); plt.close(fig)

# ---- 5. Supertrend parameter heatmap (train window, ret/DD) ----
train = full[(full.index >= "2019-03-27") & (full.index < "2022-04-01")]
ns = [7, 10, 14, 20]; ms = [2.0, 2.5, 3.0, 3.5]
Z = np.zeros((len(ns), len(ms)))
for i, n in enumerate(ns):
    for j, m in enumerate(ms):
        pos = E.strat_st_ema(train, n, m, 200)
        met = E.metrics(E.run(train, pos, label=""), train)
        Z[i, j] = met["ret_over_dd"]
fig, ax = plt.subplots(figsize=(7, 5), dpi=150)
im = ax.imshow(Z, cmap=matplotlib.colors.LinearSegmentedColormap.from_list(
    "seq", ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"]), aspect="auto")
ax.set_xticks(range(len(ms)), [f"×{m}" for m in ms])
ax.set_yticks(range(len(ns)), [f"ATR {n}" for n in ns])
for i in range(len(ns)):
    for j in range(len(ms)):
        ax.text(j, i, f"{Z[i,j]:.2f}", ha="center", va="center",
                color="#ffffff" if Z[i,j] > Z.max()*0.55 else INK, fontsize=10, fontweight="bold")
ax.set_title("Supertrend(ATR, mult) + EMA200 — CAGR / maxDD\n(train 2019–2022; broad plateau = robust)")
ax.set_xlabel("ATR multiplier"); ax.set_ylabel("ATR period")
fig.tight_layout(); fig.savefig("chart_heatmap.png", facecolor=PAGE); plt.close(fig)

print("charts written")
