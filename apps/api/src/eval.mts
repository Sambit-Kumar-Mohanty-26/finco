/**
 * The eval gate, as a command.
 *
 *   node --experimental-strip-types src/eval.mts --rows 5000 --seed 20260824
 *
 * Separate from score.check.mts on purpose. The check file is an assertion —
 * it fails loudly and prints nothing a machine can read. This writes the
 * scorecard as JSON so CI can keep it as a build artefact and diff it against
 * the one main produced, which is the only way to see a metric sliding down
 * over ten pull requests that each still passed.
 *
 * It exits non-zero when the gate fails, so it needs no wrapper in the
 * workflow, and it never touches a database: the scenario is generated, scored
 * and thrown away. An eval that reads production data is not reproducible and
 * cannot be run on a fork.
 */
import { writeFileSync } from "node:fs";
import { gate, score, THRESHOLDS } from "./score.ts";
import { reconcile } from "./recon/engine.ts";
import { buildScenario } from "./recon/scenario.ts";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i < 0 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};
const flag = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};

const rows = arg("rows", 5000);
const seed = arg("seed", 20260824);
const out = flag("out");

const sc = buildScenario(rows, seed);
const t0 = performance.now();
const result = reconcile(sc);
const ms = Math.round(performance.now() - t0);
const card = score(sc, result, sc.truth);
const failures = gate(card);

const report = {
  rows: card.totalRows,
  seed,
  ms,
  runHash: card.runHash,
  autoMatchPct: card.autoMatchPct,
  precision: card.precision,
  recall: card.recall,
  falseMatches: card.falseMatches.length,
  valueCoveragePct: card.valueCoveragePct,
  exceptionF1: card.exceptionF1,
  identityClosurePct: card.identityClosurePct,
  unprovenPaise: card.unprovenPaise,
  exceptionDetail: card.exceptionDetail,
  thresholds: THRESHOLDS,
  failures,
  passed: failures.length === 0,
};

if (out) writeFileSync(out, JSON.stringify(report, null, 2));

// A one-line summary for the log, and the JSON for the artefact. Both, because
// the log is what a person reads at 6pm and the JSON is what the diff reads.
console.log(
  `eval ${report.rows} rows seed ${seed}: ` +
    `match ${report.autoMatchPct}% · precision ${report.precision} · recall ${report.recall} · ` +
    `F1 ${report.exceptionF1} · coverage ${report.valueCoveragePct}% · ` +
    `closure ${report.identityClosurePct}% · ${report.falseMatches} false · ${ms}ms`,
);

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f.metric}: got ${f.got}, want ${f.want} — ${f.note}`);
  process.exit(1);
}
