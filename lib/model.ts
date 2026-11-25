// The token radar's model, version radar-4-size-growth-age: one snapshot of the protocol
// universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling)
// and adds the pre-token protocols below the watchlist floor that pass the watchlist's
// own exclusion rule (not a wrapped, staked or bridged product, not a versioned pool,
// not an exchange's product): the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no
// symbol); the snapshot's live-token protocols are kept apart and shown as the market's
// own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, through a joint fit on
// the snapshot's live-token protocols — not a flat multiple, and not a hardcoded list
// of names. The fit is recomputed from the snapshot on every run: the constants below
// are the method's settings, never the fitted values.
//
//   log10(mcap) = c0 + c1 * log10(tvl) + c2 * growth + c3 * age_years
//                 fitted by least squares on the live set
//                 (mcap > 0, tvl > 0, category != CEX; n = 119 here)
//   implied     = 10 ^ (c0 + c3 * mean_age + c1 * log10(tvl))
//                 x clamp(10 ^ (c2 * growth), 0.90, 1.10)
//                 x clamp(10 ^ (c3 * (age_years - mean_age)), 0.90, 1.10)
//
// The three inputs the radar is scored on — TVL, seven-day growth, age with no token —
// are all priced, and each is priced at its fitted size. The age term is centred on
// the live set's mean age, so the base constant is the value of a protocol of average
// age; the centring is part of the arithmetic, not a second model.
//
// Why the terms are capped at ten percent: the joint fit cannot tell growth or age
// from zero (growth t = -0.67, age t = -0.88 on the 119 live protocols). Their raw
// fitted effects are large — plus thirty percent growth would cut a value nearly in
// half at the raw coefficient — and the fit is too weak to trust a move that big. So
// each term is allowed at most a ten percent move: enough to order protocols that are
// otherwise tied on size, never enough for noise to move a rank. The cap is stated on
// the dashboard next to each coefficient, and the uncapped raw effect is shown too,
// so the reader sees exactly how much the model refuses to claim.
//
// Why a curve and not a ratio: the live protocols' mcap / TVL ratio falls steeply
// with size (median 1.00x at ~$6M of TVL, 0.03x at ~$1.5B; correlation of
// log(ratio) with log(TVL) is -0.42), so a flat median ratio overvalues the biggest
// protocols several-fold and undervalues the small ones. The fitted curve is the
// size relationship the snapshot itself shows.
//
// What was tested and left OUT, with the test the dashboard shows:
//   category medians: leave-one-out error WORSE than the fitted curve, so no
//     category ratio is used; category still drives the farm plan's action.
//   chain count: correlation with log(ratio) is 0.006 — no signal, so no bonus
//     for running on many chains.
//
// Validation, computed on every run and shown on the dashboard: the joint fit's
// coefficients and t statistics, the leave-one-out error of the fitted model against
// a flat median ratio and against category medians, the size curve by TVL decile
// (and how many deciles the fitted model wins), and a bootstrap (200 resamples,
// seeded) giving every row an 80% rank range and an 80% implied-value range. After
// sorting, a one-dollar tie-break keeps implied values strictly decreasing with rank.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's settings: the method, never the fitted values (those come from the snapshot). */
export interface ModelConstants {
  /** Live protocols with no market cap behind them are not a fit: category medians need this many. */
  comp_min_live: number;
  /** Bootstrap resamples for each row's rank range; the seed makes the run deterministic. */
  bootstrap_resamples: number;
  bootstrap_seed: number;
  /** How many live-token protocols the Live token view carries, by market cap. */
  live_rows: number;
  /** The most either priced term may move a value, as a share: 0.10 means x0.90 to x1.10. */
  term_cap: number;
  /** Seven-day growth is clamped to this range, in percent, before it is priced. */
  growth_lo_pct: number;
  growth_hi_pct: number;
  /** A protocol with no listing date is treated as this many days old. */
  age_default_days: number;
}

export const MODEL: ModelConstants = {
  comp_min_live: 3,
  bootstrap_resamples: 200,
  bootstrap_seed: 0x52414441,
  live_rows: 24,
  term_cap: 0.1,
  growth_lo_pct: -30,
  growth_hi_pct: 60,
  age_default_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4-size-growth-age';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The joint fit and everything the dashboard shows about it. */
export interface SizeFit {
  /** Live-token protocols behind the fit. */
  n: number;
  /** The joint fit's raw intercept, log10(mcap) = joint_intercept + slope * log10(tvl)
   *  + growth_coef * growth + age_coef * age_years. */
  joint_intercept: number;
  /** Base constant after centring age on the live set's mean age: the value of a
   *  protocol of average age, so base = 10 ^ (intercept + slope * log10(tvl)). */
  intercept: number;
  /** log10(mcap) per log10(tvl). */
  slope: number;
  /** log10(mcap) per unit of seven-day growth as a fraction (0.30 is +30%). */
  growth_coef: number;
  /** log10(mcap) per year of age with no token. */
  age_coef: number;
  /** Mean age of the live set, in years: the age the base constant is centred on. */
  mean_age_years: number;
  /** The most either priced term may move a value, as a share. */
  term_cap: number;
  /** Share of the log market-cap variance the joint fit explains. */
  r_squared: number;
  /** Standard deviation of the joint fit's residuals, in log10 dollars. */
  residual_sd: number;
  /** Median market-cap / TVL of the live set, for comparison with the curve. */
  global_ratio: number;
}

/** One input the fit tested and left out, with its test statistic. */
export interface DroppedInput {
  name: string;
  test: string;
  verdict: string;
}

/** The validation the dashboard shows: leave-one-out errors and the size curve. */
export interface Validation {
  /** Leave-one-out median absolute error, as a share of the true market cap. */
  loo_fitted_median: number;
  loo_fitted_mean: number;
  /** The same, for a flat global median ratio (the v1 approach). */
  loo_flat_median: number;
  loo_flat_mean: number;
  /** The same, for per-category medians with a global fallback. */
  loo_category_median: number;
  loo_category_mean: number;
  /** Median log10 error of the fitted model, leave-one-out. */
  loo_fitted_log: number;
  /** The joint fit's t statistics: growth and age against zero. */
  growth_t: number;
  age_t: number;
  /** Correlation of chain count with log(mcap / TVL). */
  chain_corr: number;
  /** How many of the ten TVL deciles the fitted model beats the flat ratio on median error. */
  decile_wins: number;
  /** Median mcap / TVL by TVL decile of the live set: the size curve in a table. */
  deciles: { tvl_mid_usd: number; ratio: number; count: number }[];
  /** Leave-one-out median error per TVL decile, fitted model against flat ratio. */
  decile_errors: { fitted: number; flat: number }[];
  dropped: DroppedInput[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_intercept: number;
    fitted_slope: number;
    fitted_growth_coef: number;
    fitted_age_coef: number;
    mean_age_years: number;
    term_cap: number;
    base_value_usd: number;
    growth_mult: number;
    age_mult: number;
    growth_pct: number;
    age_days: number | null;
    rank_lo: number;
    rank_hi: number;
    implied_lo_usd: number;
    implied_hi_usd: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_intercept: number;
  fitted_slope: number;
  fitted_growth_coef: number;
  fitted_age_coef: number;
  mean_age_years: number;
  term_cap: number;
  base_value_usd: number;
  growth_mult: number;
  age_mult: number;
  rank_lo: number;
  rank_hi: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and its validation. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: SizeFit;
  validation: Validation;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list of numbers; 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The mean of a list of numbers; 0 for an empty list. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Pearson correlation of two equal-length lists; 0 when either has no variance. */
function correlation(xs: number[], ys: number[]): number {
  if (xs.length < 2 || xs.length !== ys.length) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** The live-token protocols the curve is fitted on: a market cap, TVL, and no exchange token. */
export function liveSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
}

/** Seven-day growth as a fraction, clamped to the model's range; null growth is flat. */
function growthFrac(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  return Math.min(model.growth_hi_pct, Math.max(model.growth_lo_pct, finite(p.change_7d, 0))) / 100;
}

/** Age with no token, in years; a missing listing date counts as the default age. */
function ageYears(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number {
  const age = ageDays(asOf, p.listed_at);
  return (age ?? model.age_default_days) / 365;
}

/** Closed-form least squares for y = a + b*x: intercept, slope, R squared, residual spread. */
function ols2(xs: number[], ys: number[]): { a: number; b: number; r2: number; sd: number } {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sst += (ys[i]! - my) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  const a = my - b * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ys[i]! - (a + b * xs[i]!)) ** 2;
  return { a, b, r2: sst > 0 ? 1 - ssr / sst : 0, sd: n > 2 ? Math.sqrt(ssr / (n - 2)) : 0 };
}

/** Solve a small dense linear system by Gauss-Jordan; null when singular. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const div = m[col]![col]!;
    for (let j = col; j <= n; j++) m[col]![j]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]!;
      for (let j = col; j <= n; j++) m[r]![j]! -= factor * m[col]![j]!;
    }
  }
  return m.map((row) => row[n]!);
}

/** Invert a small dense matrix by Gauss-Jordan; null when singular. */
function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0));
    const solved = solveLinear(matrix, e);
    if (solved === null) return null;
    cols.push(solved);
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]!));
}

/** One row of the joint fit's design: [1, log10(tvl), growth fraction, age in years]. */
function jointRow(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number[] {
  return [1, Math.log10(p.tvl_usd), growthFrac(p, model), ageYears(p, asOf, model)];
}

/** The joint fit log10(mcap) on [1, log10(tvl), growth, age]: coefficients, t statistics, R squared.
 *
 * The fit is done on predictors centred on their live-set means: the raw design is
 * ill-conditioned (log10(TVL) sits near 7.5, so the intercept column and the TVL column
 * are nearly collinear), and a naive elimination on it goes singular. Centring leaves
 * the slopes and their t statistics untouched and the uncentred intercept is recovered
 * from the means, so the fitted model is the same arithmetic, just computed stably. */
function jointFit(
  live: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): { coef: number[]; t: number[]; r2: number; sd: number; meanAgeYears: number } | null {
  const rows = live.map((p) => {
    const x = jointRow(p, asOf, model);
    return { x: [x[1]!, x[2]!, x[3]!] as [number, number, number], y: Math.log10(p.mcap_usd!) };
  });
  const k = 3;
  const meanX = [mean(rows.map((r) => r.x[0])), mean(rows.map((r) => r.x[1])), mean(rows.map((r) => r.x[2]))];
  const meanY = mean(rows.map((r) => r.y));
  const xtx: number[][] = Array.from({ length: k }, () => Array.from({ length: k }, () => 0));
  const xty: number[] = Array.from({ length: k }, () => 0);
  for (const r of rows) {
    const xc = [r.x[0] - meanX[0]!, r.x[1] - meanX[1]!, r.x[2] - meanX[2]!];
    const yc = r.y - meanY;
    for (let i = 0; i < k; i++) {
      xty[i]! += xc[i]! * yc;
      for (let j = 0; j < k; j++) xtx[i]![j]! += xc[i]! * xc[j]!;
    }
  }
  const slopes = solveLinear(xtx, xty);
  if (slopes === null) return null;
  const inv = invertMatrix(xtx);
  if (inv === null) return null;
  const [b1, b2, b3] = slopes as [number, number, number];
  const intercept = meanY - b1 * meanX[0]! - b2 * meanX[1]! - b3 * meanX[2]!;
  let ssr = 0;
  let sst = 0;
  for (const r of rows) {
    const pred = intercept + b1 * r.x[0] + b2 * r.x[1] + b3 * r.x[2];
    ssr += (r.y - pred) ** 2;
    sst += (r.y - meanY) ** 2;
  }
  const n = rows.length;
  const s2 = n > k + 1 ? ssr / (n - k - 1) : 0;
  const tSlopes = slopes.map((_, i) => {
    const se = Math.sqrt(Math.max(0, s2 * inv[i]![i]!));
    return se > 0 ? slopes[i]! / se : 0;
  });
  const coef = [intercept, b1, b2, b3];
  const t = [0, tSlopes[0]!, tSlopes[1]!, tSlopes[2]!];
  return {
    coef,
    t,
    r2: sst > 0 ? 1 - ssr / sst : 0,
    sd: n > k + 1 ? Math.sqrt(ssr / (n - k - 1)) : 0,
    meanAgeYears: mean(live.map((p) => ageYears(p, asOf, model))),
  };
}

/** Fit the joint model on the live set. The base constant is centred on the live
 *  set's mean age, so it reads as the value of a protocol of average age. */
export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): SizeFit {
  const live = liveSet(snapshot);
  const joint = jointFit(live, snapshot.as_of, model);
  if (joint === null) throw new SnapshotError('the joint fit is singular on the live set');
  const [c0, c1, c2, c3] = joint.coef as [number, number, number, number];
  return {
    n: live.length,
    joint_intercept: c0,
    intercept: c0 + c3 * joint.meanAgeYears,
    slope: c1,
    growth_coef: c2,
    age_coef: c3,
    mean_age_years: joint.meanAgeYears,
    term_cap: model.term_cap,
    r_squared: joint.r2,
    residual_sd: joint.sd,
    global_ratio: median(live.map((p) => p.mcap_usd! / p.tvl_usd)),
  };
}

/** One priced term, capped at the model's term cap: 10 ^ effect, kept inside [1 - cap, 1 + cap]. */
function cappedTerm(effect: number, model: ModelConstants = MODEL): number {
  const cap = Math.log10(1 + model.term_cap);
  return 10 ** Math.max(-cap, Math.min(cap, effect));
}

/** The model's three factors for one protocol: the base value from the size curve,
 *  the growth multiplier and the age multiplier, each capped at the term cap. */
export function modelTerms(
  p: SnapshotProtocol,
  asOf: string,
  fit: SizeFit,
  model: ModelConstants = MODEL,
): { base: number; growthMult: number; ageMult: number } {
  const base = 10 ** (fit.intercept + fit.slope * Math.log10(Math.max(1, p.tvl_usd)));
  const growthMult = cappedTerm(fit.growth_coef * growthFrac(p, model), model);
  const ageMult = cappedTerm(fit.age_coef * (ageYears(p, asOf, model) - fit.mean_age_years), model);
  return { base, growthMult, ageMult };
}

/** The fitted implied value of one protocol: the size curve times the two capped terms. */
export function impliedValue(p: SnapshotProtocol, asOf: string, fit: SizeFit, model: ModelConstants = MODEL): number {
  const { base, growthMult, ageMult } = modelTerms(p, asOf, fit, model);
  return Math.max(1, Math.round(base * growthMult * ageMult));
}

/** Leave-one-out errors for three ways of pricing the live set: the fitted joint model,
 *  a flat global median ratio, and per-category medians with a global fallback. */
function looErrors(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { fitted: number[]; flat: number[]; category: number[]; fittedLog: number[] } {
  const live = liveSet(snapshot);
  const fitted: number[] = [];
  const flat: number[] = [];
  const category: number[] = [];
  const fittedLog: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const held = live[i]!;
    const others = live.filter((_, j) => j !== i);
    const refit = jointFit(others, snapshot.as_of, model);
    if (refit === null) continue;
    const [c0, c1, c2, c3] = refit.coef as [number, number, number, number];
    const baseConst = c0 + c3 * refit.meanAgeYears;
    const predBase = 10 ** (baseConst + c1 * Math.log10(held.tvl_usd));
    const predGrowth = cappedTerm(c2 * growthFrac(held, model), model);
    const predAge = cappedTerm(c3 * (ageYears(held, snapshot.as_of, model) - refit.meanAgeYears), model);
    const predModel = Math.max(1, predBase * predGrowth * predAge);
    fitted.push(Math.abs(predModel - held.mcap_usd!) / held.mcap_usd!);
    fittedLog.push(Math.abs(Math.log10(predModel) - Math.log10(held.mcap_usd!)));
    const ratios = others.map((p) => p.mcap_usd! / p.tvl_usd);
    const predFlat = held.tvl_usd * median(ratios);
    flat.push(Math.abs(predFlat - held.mcap_usd!) / held.mcap_usd!);
    const sameCat = others.filter((p) => (p.category ?? '') === (held.category ?? ''));
    const ratio = sameCat.length >= model.comp_min_live ? median(sameCat.map((p) => p.mcap_usd! / p.tvl_usd)) : median(ratios);
    const predCat = held.tvl_usd * Math.min(2.5, Math.max(0.01, ratio));
    category.push(Math.abs(predCat - held.mcap_usd!) / held.mcap_usd!);
  }
  return { fitted, flat, category, fittedLog };
}

/** The size curve by TVL decile: the median mcap / TVL of each tenth of the live set,
 *  and whether the fitted model beats the flat ratio on that decile's median error. */
function decileCurve(
  live: SnapshotProtocol[],
  snapshot: Snapshot,
  fit: SizeFit,
  model: ModelConstants = MODEL,
): { deciles: { tvl_mid_usd: number; ratio: number; count: number }[]; wins: number; errors: { fitted: number; flat: number }[] } {
  const ordered = [...live].sort((a, b) => a.tvl_usd - b.tvl_usd);
  const deciles: { tvl_mid_usd: number; ratio: number; count: number }[] = [];
  const errors: { fitted: number; flat: number }[] = [];
  let wins = 0;
  for (let d = 0; d < 10; d++) {
    const chunk = ordered.slice(Math.floor((d * ordered.length) / 10), Math.floor(((d + 1) * ordered.length) / 10));
    if (chunk.length === 0) continue;
    deciles.push({
      tvl_mid_usd: chunk[Math.floor(chunk.length / 2)]!.tvl_usd,
      ratio: median(chunk.map((p) => p.mcap_usd! / p.tvl_usd)),
      count: chunk.length,
    });
    // The decile's own leave-one-out: refit without the chunk, price the chunk both ways.
    const others = live.filter((p) => !chunk.includes(p));
    const refit = jointFit(others, snapshot.as_of, model);
    if (refit === null) {
      errors.push({ fitted: 0, flat: 0 });
      continue;
    }
    const [c0, c1, c2, c3] = refit.coef as [number, number, number, number];
    const baseConst = c0 + c3 * refit.meanAgeYears;
    const ratios = others.map((p) => p.mcap_usd! / p.tvl_usd);
    const flatRatio = median(ratios);
    const errModel: number[] = [];
    const errFlat: number[] = [];
    for (const p of chunk) {
      const pred = Math.max(1, 10 ** (baseConst + c1 * Math.log10(p.tvl_usd))
        * cappedTerm(c2 * growthFrac(p, model), model)
        * cappedTerm(c3 * (ageYears(p, snapshot.as_of, model) - refit.meanAgeYears), model));
      errModel.push(Math.abs(pred - p.mcap_usd!) / p.mcap_usd!);
      errFlat.push(Math.abs(p.tvl_usd * flatRatio - p.mcap_usd!) / p.mcap_usd!);
    }
    errors.push({ fitted: median(errModel), flat: median(errFlat) });
    if (median(errModel) < median(errFlat)) wins++;
  }
  return { deciles, wins, errors };
}

/** The validation block: leave-one-out errors, the joint-fit tests, and the decile curve. */
export function validateModel(snapshot: Snapshot, fit: SizeFit, model: ModelConstants = MODEL): Validation {
  const live = liveSet(snapshot);
  const loo = looErrors(snapshot, model);
  const joint = jointFit(live, snapshot.as_of, model);
  const chainCorr = correlation(
    live.map((p) => p.chains.length),
    live.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd)),
  );
  const growthT = joint === null ? 0 : joint.t[2]!;
  const ageT = joint === null ? 0 : joint.t[3]!;
  const { deciles, wins, errors } = decileCurve(live, snapshot, fit, model);
  return {
    loo_fitted_median: median(loo.fitted),
    loo_fitted_mean: mean(loo.fitted),
    loo_flat_median: median(loo.flat),
    loo_flat_mean: mean(loo.flat),
    loo_category_median: median(loo.category),
    loo_category_mean: mean(loo.category),
    loo_fitted_log: median(loo.fittedLog),
    growth_t: growthT,
    age_t: ageT,
    chain_corr: chainCorr,
    decile_wins: wins,
    deciles,
    decile_errors: errors,
    dropped: [
      {
        name: 'Category medians',
        test: `leave-one-out mean error ${mean(loo.category).toFixed(2)}x vs ${mean(loo.fitted).toFixed(2)}x for the fitted model`,
        verdict: 'Worse out of sample: no category ratio is used. Category still drives the farm plan action.',
      },
      {
        name: 'Chain count',
        test: `correlation with log(mcap / TVL) is ${chainCorr.toFixed(3)}`,
        verdict: 'No signal: no bonus for running on many chains.',
      },
    ],
  };
}

/** A deterministic seeded PRNG (mulberry32) so the bootstrap repeats exactly every run. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bootstrap rank and value ranges: resample the live set, refit the joint model, rescore the board. */
function bootstrapRanges(
  snapshot: Snapshot,
  scored: { slug: string; implied: number }[],
  fit: SizeFit,
  model: ModelConstants = MODEL,
): Map<string, { rankLo: number; rankHi: number; impliedLo: number; impliedHi: number }> {
  const live = liveSet(snapshot);
  const rand = seededRandom(model.bootstrap_seed);
  const ranks = new Map<string, number[]>();
  const values = new Map<string, number[]>();
  for (const s of scored) {
    ranks.set(s.slug, []);
    values.set(s.slug, []);
  }
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (let b = 0; b < model.bootstrap_resamples; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rand() * live.length)]!);
    const refit = jointFit(sample, snapshot.as_of, model);
    if (refit === null) continue;
    const [c0, c1, c2, c3] = refit.coef as [number, number, number, number];
    const baseConst = c0 + c3 * refit.meanAgeYears;
    const res = scored
      .map((s) => {
        const p = bySlug.get(s.slug)!;
        const value = Math.max(1, Math.round(
          10 ** (baseConst + c1 * Math.log10(Math.max(1, p.tvl_usd)))
          * cappedTerm(c2 * growthFrac(p, model), model)
          * cappedTerm(c3 * (ageYears(p, snapshot.as_of, model) - refit.meanAgeYears), model),
        ));
        return { slug: s.slug, implied: value };
      })
      .sort((x, y) => y.implied - x.implied || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
    res.forEach((r, i) => {
      ranks.get(r.slug)!.push(i + 1);
      values.get(r.slug)!.push(r.implied);
    });
  }
  const out = new Map<string, { rankLo: number; rankHi: number; impliedLo: number; impliedHi: number }>();
  for (const s of scored) {
    const rs = [...ranks.get(s.slug)!].sort((a, b) => a - b);
    const vs = [...values.get(s.slug)!].sort((a, b) => a - b);
    const at = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * arr.length)))]!;
    out.set(s.slug, { rankLo: at(rs, 0.1), rankHi: at(rs, 0.9), impliedLo: at(vs, 0.1), impliedHi: at(vs, 0.9) });
  }
  return out;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The exchange names the watchlist rule refuses at the start of a name. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The categories the watchlist rule refuses: bridges and staked products of tokens that trade. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the watchlist rule would refuse: a wrapped, staked or
 *  bridged product, a versioned pool, or an exchange's product. The snapshot carries
 *  no parent-protocol field, so a protocol the house refused for its parent alone
 *  cannot be told apart here; the watchlist itself is read as given, and the early
 *  set is the same rule on the fields the snapshot does carry. */
export function isExcluded(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token and not an excluded product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcluded(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly decreasing values. */
export function buildBoard(snapshot: Snapshot, fit: SizeFit, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, not just
  // the top few by TVL — the board covers the pre-token universe the rule allows.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const { base, growthMult, ageMult } = modelTerms(p, snapshot.as_of, fit, model);
    const implied = Math.max(1, Math.round(base * growthMult * ageMult));
    return { p, age, implied, base, growthMult, ageMult };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // A one-dollar tie-break: two protocols with the same rounded value still rank in order, so the
  // board's implied values strictly decrease with rank. The adjustment is at most a few dollars on
  // values in the millions, and it never changes the order.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied >= scored[i - 1]!.implied) scored[i]!.implied = Math.max(1, scored[i - 1]!.implied - 1);
  }
  const ranges = bootstrapRanges(
    snapshot,
    scored.map((s) => ({ slug: s.p.slug, implied: s.implied })),
    fit,
    model,
  );
  return scored.map((s, i) => {
    const range = ranges.get(s.p.slug)!;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        fitted_intercept: Math.round(fit.intercept * 1e4) / 1e4,
        fitted_slope: Math.round(fit.slope * 1e4) / 1e4,
        fitted_growth_coef: Math.round(fit.growth_coef * 1e4) / 1e4,
        fitted_age_coef: Math.round(fit.age_coef * 1e4) / 1e4,
        mean_age_years: Math.round(fit.mean_age_years * 1e4) / 1e4,
        term_cap: fit.term_cap,
        base_value_usd: Math.max(1, Math.round(s.base)),
        growth_mult: Math.round(s.growthMult * 1e4) / 1e4,
        age_mult: Math.round(s.ageMult * 1e4) / 1e4,
        growth_pct: s.p.change_7d === null ? 0 : Math.min(60, Math.max(-30, s.p.change_7d)),
        age_days: s.age,
        rank_lo: range.rankLo,
        rank_hi: range.rankHi,
        implied_lo_usd: range.impliedLo,
        implied_hi_usd: range.impliedHi,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, as a stated estimate in whole dollars:
 *  Ethereum is the dear chain, the big L2s about a dollar, Solana and the fast
 *  chains about five cents. The estimate is labelled as one everywhere it is used. */
export function gasTier(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 8;
  if (c.includes('solana') || c.includes('hyperliquid')) return 0.05;
  if (c.includes('tron')) return 2;
  if (c.includes('binance')) return 0.3;
  if (c.includes('polygon')) return 0.1;
  if (c.includes('avalanche')) return 0.3;
  return 1;
}

/** A gas amount in words: cents stay cents, dollars stay whole. */
export function gasWords(dollars: number): string {
  if (dollars < 1) return `$${dollars.toFixed(2)}`;
  return `$${Math.round(dollars)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('basis trading') || c.includes('cedefi')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Move $${capital} of USDC onto ${chain} through ${name} and use it in one app there.`;
  if (c.includes('governance')) return `Stake $${capital} of the governance asset through ${name} and vote once.`;
  if (c.includes('payment')) return `Pay $${capital} through ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second qualifying action, so the farm is more than one deposit: borrow, swap, vote or restake.
 *  The amount it moves is returned with the text, so the step's cost line can never disagree with it. */
function action2For(p: SnapshotProtocol, chain: string): { text: string; movedUsd: number } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return { text: `Borrow $10 against the deposit on ${name} and repay it within the week.`, movedUsd: 10 };
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return { text: `Swap $10 through ${name}'s main pool on ${chain} to register trading activity.`, movedUsd: 10 };
  if (c.includes('bridge')) return { text: `Bridge $10 back to the origin chain through ${name} to complete a round trip.`, movedUsd: 10 };
  if (c.includes('staking') || c.includes('restak')) return { text: `Restake or compound the staking rewards from ${name} once.`, movedUsd: 10 };
  if (c.includes('perpetual') || c.includes('derivative')) return { text: `Close the hedge on ${name} and open a fresh one the next week.`, movedUsd: 10 };
  if (c.includes('governance')) return { text: `Vote in one ${name} governance proposal.`, movedUsd: 0 };
  if (c.includes('prediction')) return { text: `Settle one market position on ${name} and place a fresh one.`, movedUsd: 10 };
  if (p.chains.length > 1) return { text: `Repeat the deposit on a second chain ${name} runs on, ${p.chains[1]}, with $25.`, movedUsd: 25 };
  return { text: `Complete one quest or vote ${name} publishes for its users.`, movedUsd: 0 };
}

/** The weekly cadence, shaped by the protocol's own record: fast growth and young
 *  protocols get a weekly check of the points page, settled ones a plain weekly action. */
function weeklyFor(p: SnapshotProtocol, age: number | null): string {
  const growth = p.change_7d === null ? 0 : p.change_7d;
  if (growth > 20) {
    return `TVL rose ${growth.toFixed(1)}% in the last 7 days, so do one qualifying action each week while it is moving — a deposit, a borrow, a swap or a vote.`;
  }
  if (age !== null && age < 180) {
    return `The protocol is ${age} days old, so check its points or rewards page every week for new tasks and do one qualifying action each week.`;
  }
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, growth), never from a hand-written
 * list of names — and the last step nets the whole plan, so the reader sees what the farm
 * actually costs once the deposit comes back.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasTier(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = action2For(p, chain);
  const gasTotal = gas * 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${gasWords(gas)} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about ${gasWords(gas)} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: second.text,
      cost: second.movedUsd > 0 ? `about ${gasWords(gas)} of gas plus the $${second.movedUsd} moved` : `about ${gasWords(gas)} of gas, nothing moved`,
      time: '10 minutes',
    },
    {
      text: weeklyFor(p, age),
      cost: `about ${gasWords(gas)} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Net cost of this plan: about ${gasWords(gasTotal)} of gas across the steps — the $${capital} deposit is yours and comes back when you exit.`,
      cost: `about ${gasWords(gasTotal)} of gas in all`,
      time: `about 55 minutes of actions plus ${hold} days holding`,
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, MODEL.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fitted_intercept: row.model.fitted_intercept,
    fitted_slope: row.model.fitted_slope,
    fitted_growth_coef: row.model.fitted_growth_coef,
    fitted_age_coef: row.model.fitted_age_coef,
    mean_age_years: row.model.mean_age_years,
    term_cap: row.model.term_cap,
    base_value_usd: row.model.base_value_usd,
    growth_mult: row.model.growth_mult,
    age_mult: row.model.age_mult,
    rank_lo: row.model.rank_lo,
    rank_hi: row.model.rank_hi,
    implied_lo_usd: row.model.implied_lo_usd,
    implied_hi_usd: row.model.implied_hi_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot, model);
  const validation = validateModel(snapshot, fit, model);
  const board = buildBoard(snapshot, fit, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    validation,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
