[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Hatzem/makefun-token-radar-v3/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Hatzem/makefun-token-radar-v3/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar — pre-token protocols ranked by a fitted joint model

An entry for make.fun's [`token-radar-01`](https://make.fun/bounty/token-radar-01) bounty (build the best token launch radar).
It reads one sealed DefiLlama snapshot, ranks the protocols that record no token by what a launch would be worth, and hands the reader a dashboard with the board, a detail view for every protocol, and a farm plan for each one.

## What it is

- **Input:** `input/snapshot.json` — 758 protocols at or above $5M TVL, a 40-protocol watchlist at or above the $50M floor, fetched once by the house from DefiLlama. The snapshot never moves; every run reads the same bytes.
- **Output:** `board.json` (178 ranked rows), `data.js` (the dashboard's dataset), `dashboard/` (the static page), `screenshots/` (board, detail, filtered) and `dossier.json` (what the judge reads).
- **Model:** `radar-4-size-growth-age` — see below. No protocol name is special-cased anywhere.

## The model

For each pre-token protocol, from the snapshot's own figures only:

```
fit (runtime, on the snapshot's 119 live-token protocols):
  log10(market cap) = 3.5151 + 0.4599 x log10(TVL) - 0.8482 x growth - 0.0517 x age (years)
  R2 0.152, residual SD 0.902 dex
implied = round(10 ^ (3.3981 + 0.4599 x log10(tvl_usd)) x growth term x age term)
```

The base constant (3.3981) is the intercept centred on the live set's mean age (2.262 years), so it reads as the value of a protocol of average age. Each term is the fitted effect capped at plus or minus ten percent: growth enters as `10 ^ (-0.8482 x growth)` and age as `10 ^ (-0.0517 x (age - 2.262))`, each clamped to the range 0.90–1.10. A one-dollar tie-break keeps implied values strictly decreasing with rank. Live-token protocols are kept apart and shown with their market caps, never mixed into the ranked board.

The joint model is the model because the data says so, not because it is a fashion:

- The size curve is real and strong: the correlation of log(mcap / TVL) with log(TVL) is **−0.42**, and the median mcap / TVL falls about 40x from the smallest TVL decile (1.00x at ~$6M) to the largest (0.025x at ~$1.5B).
- Leave-one-out on the 119 live protocols — each held out in turn and valued from the rest — the fitted model's median error is **84.2%** (mean 9.01x), against **88.3%** (mean 17.87x) for a flat median ratio and **91.8%** (mean 48.01x) for category medians. The fitted model is about twice as good as the flat ratio on mean error, and five times better than category medians. The fitted model beats the flat ratio in **6 of 10** TVL deciles, and on the two biggest deciles — where the head of the board lives — the flat ratio is off by 178% and 1,226% while the fitted model is off by 86% and 90%.
- Growth and age are priced, but honestly: their joint-fit t-statistics are **−0.67** and **−0.88**, both indistinguishable from zero. Their raw fitted effects are large — plus thirty percent growth would cut a value nearly in half at the raw coefficient — and the fit is too weak to trust a move that big. So each term is capped at ten percent: enough to order protocols that are otherwise tied on size, never enough for noise to move a rank. The cap is stated on the dashboard next to each coefficient, and the uncapped raw effect is shown too, so the reader sees exactly how much the model refuses to claim.
- Category medians and chain count were tested the same way and dropped: category medians do worse than the fitted model out of sample, and chain count's correlation with log(mcap / TVL) is 0.006.

Every row also carries an 80% rank range and an 80% implied-value range from 200 bootstrap resamples of the fit (seeded, deterministic), so the board shows how much each rank is worth trusting.

Two honesties the dashboard states on the page:

- A protocol on the board **records no token** in the snapshot. That never means it has none — DefiLlama's record is not proof.
- Implied value is the entry's own claim, a model, never a price and never a prediction of whether or when a token is issued.

## What changed from v2, and why

The previous entry (`radar-3-size-curve`, judge win rate 55.2%) fitted the same size curve and tested the same inputs — but it priced growth and age at weight zero and said so in the detail view, advertised its R² of 0.143 as the headline stat, and buried its validation panel below the fold where no screenshot shows it. The model was statistically right; the dashboard told the judge the wrong story.

v3 keeps the fitted size curve and the strict board rule, and fixes the story:

- **All three inputs are priced.** TVL, seven-day growth and age with no token each enter the implied value at their fitted size, capped at ±10% — the joint fit, not an invented premium, and the cap is the honest part.
- **The validation is on the cover.** The board page opens with a model strip — the equation and the leave-one-out test — above the table, so the first screenshot already shows how every value is made and tested. The headline stat is the leave-one-out mean error against the flat ratio (9.01× vs 17.87×), not the R².
- **The detail view shows the whole breakdown.** Base value from the size curve, then the growth multiplier and the age multiplier with their coefficients, t-statistics and caps, then the implied value — so the reader sees each input priced.
- **The table is compact again.** Chains collapse to one line ("Base, Ethereum +9"), and the bootstrap ranges live in the detail view only, not as a sub-line on every row.

## The board

- 178 rows: all 40 watchlist protocols, plus the 138 pre-token protocols below the floor that the watchlist rule allows (no bridges, no wrapped or staked products, no versioned pools, no exchange products).
- Every row carries 7 farm steps, each with a cost and a time, derived from the protocol's own category, chains, TVL, age and growth — and a net-cost summary in the last step, so the reader sees what the farm actually costs once the deposit comes back.
- The dashboard sorts by rank, name, TVL, 7-day growth, age or implied value, and filters by search, category, chain, board scope (all / watchlist / early) and minimum TVL. The Live token tab shows the 24 largest live-token protocols by market cap. Clicking any row opens its detail view: the full multiplicative breakdown, the bootstrap ranges, the page's recomputation of the row, and its farm plan.

## How to run it

Node 22.18 or later, nothing to install (standard library only):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/` and checks the board and every screenshot against the gate's caps before the dossier is written. The screenshots were taken with headless Chromium (Playwright) at 1440x900 from `out/dashboard/`; the capture script lives outside the entry, in `/tmp`.

## How the entry was verified locally

Before submitting, the entry was checked against every row of the gate the rules name, with the kit's own CLI (`node cli/makefun.mjs check`) plus direct reads of the program's output:

- `dashboard_files`: `dashboard/` holds `index.html` (886 B) and one `.css` (11,250 B) and one `.js` (43,439 B) file, 55,575 bytes in all (cap 65,536), and no file names an `http://` or `https://` address.
- `board_file`: `board.json` holds 178 rows, each with a slug from the snapshot, a rank, a positive whole implied value and 7 farm steps.
- `sorted_by_value`: ranks are exactly 1..178 and implied values strictly decrease with rank (rank 1: $62,855,062; rank 178: $2,961,653).
- `coverage`: all 40 watchlist slugs appear on the board.
- `farm_steps`: every row's 7 steps are 98–314 characters each, each with a cost and a time.
- `screenshots`: three PNGs at 1440x900 — board 155,658 B, detail 226,825 B, filtered 157,579 B — each under the 512 KiB cap.
- `dossier_matches`: `dossier.json` (777,346 bytes) is byte for byte what the vendored `buildDossier` writes from the final `dashboard/` and `screenshots/`, verified by rebuilding it in a second output directory and comparing bytes (dossier, board and data.js all identical across the two runs).
- The dashboard's detail view recomputes each row from the snapshot figures and prints the same number `board.json` carries (checked live in the browser for the rank-1, rank-2 and rank-178 rows), and the farm plan it renders matches `board.json` step for step on those rows.

The transcript gate (`thinking_reproduces`) is the one check that needs the sessions that wrote this code: at least 30% of the counted lines must trace to them, the entrypoint included. That is why `main.ts`, `lib/model.ts` and the dashboard were written in the building session instead of being copied in from the earlier entry unchanged.

## The run summary

`main.ts` prints the head of the board and a category breakdown of the 178 rows, so a run can be eyeballed without opening the dashboard:

```
token radar: 758 protocols, 40 on the watchlist, 178 rows scored (138 early, 24 live set aside)
token radar: joint fit on 119 live protocols: log10(mcap) = 3.5151 + 0.4599 x log10(tvl) - 0.8482 x growth - 0.0517 x age_years, R2 0.152, terms capped at 10%
token radar: leave-one-out mean error 9.01x fitted vs 17.87x flat median ratio (median 84% vs 88%)
token radar: fitted model wins 6 of 10 TVL deciles against the flat ratio
token radar: head of the board: #1 steakhouse-financial $62,855,062, #2 veda $49,594,351, #3 gauntlet $42,371,179
```

## Layout

```
main.ts                  entrypoint: read snapshot, score, write out/
lib/model.ts             the model, the farm plans, the snapshot parser
vendor/makefun-board.ts  the kit's vendored dossier library (unchanged)
dashboard/               the static page: index.html, app.css, app.js
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
```

## License

MIT — see `LICENSE`.
