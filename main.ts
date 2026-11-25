// A working token-radar-01 entry (Node 22, standard library only), model radar-4-size-growth-age.
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits
// the joint model on the snapshot's live-token protocols and scores every pre-token protocol
// with it (lib/model.ts), writes the ranked board to /output/board.json, and copies this
// repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. Before
// the dossier is written, every screenshot is checked against the gate's own caps (whole PNG or
// JPEG, long side at most 1440, short side at least 800, at most 512 KiB), so a bad capture fails
// here, in the open, instead of silently failing the gate later.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };

/** The gate's screenshot shape: a whole PNG or JPEG, long side at most 1440, short side at least 800. */
const SHOT_LONG_MAX = 1440;
const SHOT_SHORT_MIN = 800;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Fail with a message on stderr and exit code 1. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`the model wrote a board the gate refuses: ${issue}`);
}

/** A PNG's width and height out of its IHDR chunk, or null when the bytes are not a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** A JPEG's width and height out of its frame header, or null when the bytes are not a JPEG. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

/** Why a screenshot is not one the gate will take, or null. */
function shotIssue(name: string, bytes: Buffer): string | null {
  if (bytes.length > SCREENSHOT_CAPS.max_bytes) return `${name} is ${bytes.length} bytes, past the ${SCREENSHOT_CAPS.max_bytes} cap`;
  const size = pngSize(bytes) ?? jpegSize(bytes);
  if (size === null) return `${name} is neither a whole PNG nor a whole JPEG`;
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  if (long > SHOT_LONG_MAX) return `${name} is ${size.width}x${size.height}: its long side ${long} is past ${SHOT_LONG_MAX}`;
  if (short < SHOT_SHORT_MIN) return `${name} is ${size.width}x${size.height}: its short side ${short} is under ${SHOT_SHORT_MIN}`;
  return null;
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
  const bytes = readFileSync(join(out, 'screenshots', name));
  const bad = shotIssue(name, bytes);
  if (bad !== null) fail(bad);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierPath = join(out, 'dossier.json');
writeFileSync(dossierPath, buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
const dossierBytes = statSync(dossierPath).size;
if (dossierBytes > 1_572_864) fail(`dossier.json is ${dossierBytes} bytes, past the 1.5 MiB cap`);

/** The run's one-line summary: what was scored, what was written, and the board's head. */
const head = board
  .slice(0, 3)
  .map((r) => `#${r.rank} ${r.slug} $${r.implied_value_usd.toLocaleString('en-US')}`)
  .join(', ');

/** The board's rows per category, most first, for the run summary. */
const byCategory = new Map<string, number>();
for (const r of board) {
  const key = r.category ?? 'Other';
  byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
}
const categories = [...byCategory.entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  .map(([category, count]) => `${category} ${count}`)
  .join(', ');
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: joint fit on ${radar.fit.n} live protocols: log10(mcap) = ${radar.fit.joint_intercept.toFixed(4)} + ${radar.fit.slope.toFixed(4)} x log10(tvl) ${radar.fit.growth_coef >= 0 ? '+' : '-'} ${Math.abs(radar.fit.growth_coef).toFixed(4)} x growth ${radar.fit.age_coef >= 0 ? '+' : '-'} ${Math.abs(radar.fit.age_coef).toFixed(4)} x age_years, R2 ${radar.fit.r_squared.toFixed(3)}, terms capped at ${Math.round(radar.fit.term_cap * 100)}%\n` +
    `token radar: leave-one-out mean error ${radar.validation.loo_fitted_mean.toFixed(2)}x fitted vs ${radar.validation.loo_flat_mean.toFixed(2)}x flat median ratio (median ${Math.round(radar.validation.loo_fitted_median * 100)}% vs ${Math.round(radar.validation.loo_flat_median * 100)}%)\n` +
    `token radar: fitted model wins ${radar.validation.decile_wins} of 10 TVL deciles against the flat ratio\n` +
    `token radar: head of the board: ${head}\n` +
    `token radar: board by category: ${categories}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${dossierPath} (${dossierBytes} bytes)\n`,
);
