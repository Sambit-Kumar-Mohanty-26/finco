/**
 * The three review decisions, asserted.
 *   pnpm --filter @finco/web check:review
 *
 * Each of these is wrong in a way nobody would notice by looking: a timeline
 * missing a tier still renders, a bulk bar with drifted rules still looks
 * enabled, a highlighter that eats a digit still shows a plausible narration.
 */
import assert from "node:assert/strict";
import { bulkBlockReason, foldEvents, splitNarration } from "./review.ts";
import type { Exception, RunEvent } from "./api.ts";

const stage = (seq: number, key: string): RunEvent => ({
  seq,
  type: "stage",
  payload: { key, label: `tier ${key}`, detail: "", matchedRows: seq * 10, links: seq, escalated: 0, committed: seq },
});

// --- 1. live and replayed fold to the same thing ------------------------------
// This is the property the whole component rests on: opening a run three weeks
// later must show the six rows a watcher saw appear one at a time.
const all: RunEvent[] = [
  ...["T0", "T1", "T2", "T3", "T4", "T5"].map((k, i) => stage(i + 1, k)),
  { seq: 7, type: "finished", payload: { matchedRows: 4900, totalRows: 5000 } },
];

const replayed = foldEvents(all); // as GET /v1/runs/:id hands it over

let live = foldEvents([]); // as the stream delivers it, one event at a time
for (const e of all) {
  const next = foldEvents([e], live.seq);
  live = {
    stages: new Map([...live.stages, ...next.stages]),
    finished: next.finished ?? live.finished,
    failure: next.failure ?? live.failure,
    seq: next.seq,
  };
}

assert.deepEqual([...live.stages.keys()], [...replayed.stages.keys()], "live != replayed");
assert.deepEqual(live.finished, replayed.finished);
assert.equal(live.seq, replayed.seq);
assert.equal(replayed.stages.size, 6);

// --- 2. replays and out-of-order events are dropped ---------------------------
// EventSource resends from Last-Event-ID on every reconnect, so duplicates are
// the normal case, not the exception. A fold that counted them shows nine tiers.
const withReplay = foldEvents([...all, stage(3, "T2"), stage(1, "T0"), ...all]);
assert.equal(withReplay.stages.size, 6, "a replayed reconnect was counted twice");
assert.equal(withReplay.seq, 7);

// A resume asks for events after seq 4; the first four must not reappear.
const resumed = foldEvents(all, 4);
assert.deepEqual([...resumed.stages.keys()], ["T4", "T5"]);

// NaN is what Number(e.lastEventId) gives on a truncated frame.
assert.equal(foldEvents([{ seq: NaN, type: "stage", payload: { key: "T0" } }]).stages.size, 0);

// A failure is carried, and its default is not the empty string.
assert.equal(foldEvents([{ seq: 1, type: "failed", payload: {} }]).failure, "the run failed");

// --- 3. the bulk bar names the specific reason --------------------------------
const exc = (o: Partial<Exception>): Exception =>
  ({ id: "x", code: "E02", status: "OPEN", autoResolvable: true, parksTo: "9999", ...o }) as Exception;

assert.equal(bulkBlockReason([]), "Select rows with x.");

const mixed = bulkBlockReason([exc({ code: "E02" }), exc({ code: "E03" })])!;
assert.match(mixed, /E02/); // both codes named, not "invalid selection"
assert.match(mixed, /E03/);

assert.match(bulkBlockReason([exc({ status: "RESOLVED" })])!, /already resolved/);
assert.match(bulkBlockReason([exc({ code: "E07", autoResolvable: false })])!, /^E07 needs a decision/);
assert.equal(bulkBlockReason([exc({}), exc({ id: "y" })]), null, "the happy path must not be blocked");

// --- 4. the narration survives the highlighter --------------------------------
// Losing a character here is how a reviewer approves the wrong UTR.
for (const t of [
  "NEFT UTR HDFC0000123456 RZP payout",
  "IMPS/912345678901/settlement",
  "",
  "no tokens at all",
  "AXISP0000000000001 AXISP0000000000002",
  "12345", // too short to be a token
]) {
  assert.equal(splitNarration(t).join(""), t, `narration mangled: ${t}`);
}
assert.equal(splitNarration("pay HDFC0000123456 now").length, 3); // plain, token, plain
assert.equal(splitNarration("pay HDFC0000123456 now")[1], "HDFC0000123456");

console.log("review.check ok — fold, bulk bar, narration");
