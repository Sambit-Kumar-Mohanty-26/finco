"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR, paise } from "@finco/core";
import { SubsetPicker, type Candidate } from "@/components/app/SubsetPicker";
import { UndoToast } from "@/components/app/UndoToast";
import { apiSend, type Exception } from "@/lib/api";
import { useMe } from "@/lib/useMe";

/**
 * The decision half of the resolver.
 *
 * The one rule worth stating out loud: a person proposing a link goes through
 * the SAME verifier a model does. There is no human override that skips the
 * identity check. If the numbers do not close, the API answers 422 with its
 * arithmetic and that answer is printed here verbatim — the honest resolution
 * at that point is a write-off, which an approver signs, needs a reason, and
 * lands in the ledger under their name. "Trust me" is not a posting basis.
 *
 * Nothing is optimistic. The button says posting, then the page reloads from
 * the server. Showing a resolution before the ledger accepted it would be
 * showing a journal entry that may not exist.
 */

const WRITEOFF_ACCOUNTS = [
  { code: "5290", name: "Disputes and losses" },
  { code: "5210", name: "Gateway fees" },
  { code: "4090", name: "Refunds and chargebacks" },
];

export function Resolver({
  exception,
  candidates,
}: {
  exception: Exception;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const { me } = useMe();
  const signedIn = me !== null;
  const canApprove = me?.role === "approver";
  const [mode, setMode] = useState<"link" | "writeoff">(
    exception.subjectType === "bank_line" ? "link" : "writeoff",
  );
  const [refs, setRefs] = useState<string[]>([]);
  const [account, setAccount] = useState(exception.spec?.parksTo ?? "5290");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ reason: string; deltaPaise?: string } | null>(null);
  const [undone, setUndone] = useState(false);

  const resolved = exception.status !== "OPEN";

  async function submit() {
    setBusy(true);
    setRefusal(null);
    const body =
      mode === "link"
        ? {
            action: "link",
            bankRef: exception.subjectRef,
            settlementRefs: refs,
            expectedSumPaise: exception.amountPaise,
          }
        : { action: "writeoff", account, note };
    const r = await apiSend(`/v1/exceptions/${exception.id}/resolve`, body);
    setBusy(false);
    if (!r.ok) {
      setRefusal({
        reason: String(r.detail.reason ?? r.error),
        deltaPaise: r.detail.deltaPaise ? String(r.detail.deltaPaise) : undefined,
      });
      return;
    }
    router.refresh();
  }

  async function reopen() {
    setBusy(true);
    const r = await apiSend(`/v1/exceptions/${exception.id}/reopen`);
    setBusy(false);
    if (!r.ok) return setRefusal({ reason: r.error });
    setUndone(true);
    router.refresh();
  }

  if (resolved) {
    return (
      <div className="rounded-[12px] border border-line-light bg-white p-6">
        <p className="font-mono text-[11px] tracking-[0.1em] text-signal-deep uppercase">
          {exception.status}
        </p>
        <p className="mt-2 max-w-[60ch] font-mono text-[11.5px] leading-relaxed text-ink-hush">
          {exception.resolution ?? "resolved"}
        </p>
        <p className="mt-4 max-w-[60ch] font-mono text-[11px] leading-relaxed text-ink-hush">
          Reopening posts a mirror entry beside the original rather than deleting it. The journal is
          append-only: an audit trail that can lose a row is not an audit trail.
        </p>
        <button
          onClick={reopen}
          disabled={busy}
          className="mt-4 border border-ink px-4 py-2 font-mono text-[11px] uppercase hover:bg-ink hover:text-on-ink disabled:opacity-30"
        >
          {busy ? "reversing…" : "Reopen"}
        </button>
        {undone ? (
          <UndoToast
            message="Reopened — the resolution was reversed"
            onUndo={() => router.refresh()}
            onDismiss={() => setUndone(false)}
          />
        ) : null}
        {refusal ? (
          <p role="alert" className="mt-3 font-mono text-[11.5px] text-refused">
            {refusal.reason}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-line-light bg-white p-6">
      <div className="flex gap-2">
        {(["link", "writeoff"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`border px-3 py-1.5 font-mono text-[10.5px] tracking-[0.08em] uppercase ${
              mode === m ? "border-ink bg-ink text-on-ink" : "border-line-light hover:bg-paper"
            }`}
          >
            {m === "link" ? "Prove a link" : "Write off"}
          </button>
        ))}
      </div>

      {mode === "link" ? (
        <div className="mt-5">
          <p className="max-w-[60ch] font-mono text-[11px] leading-relaxed text-ink-hush">
            Pick the settlements this credit is made of. The verifier checks the identity itself —
            a selection that looks right here can still be refused, with its arithmetic.
          </p>
          <div className="mt-3">
            <SubsetPicker
              candidates={candidates}
              targetPaise={exception.amountPaise}
              selected={refs}
              onChange={setRefs}
            />
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="block font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
              account
            </span>
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="mt-1.5 w-full border border-line-light bg-white px-3 py-2 font-mono text-[12px]"
            >
              {WRITEOFF_ACCOUNTS.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
              reason (required)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Why this money is not coming back."
              className="mt-1.5 w-full border border-line-light bg-white px-3 py-2 font-mono text-[12px]"
            />
          </label>
          {!canApprove ? (
            <p className="font-mono text-[11px] text-refused">
              {signedIn
                ? "A write-off needs the approver role. Preparing one is not the same right as signing it."
                : "Sign in to post. Every posting carries the name of the person who made it."}
            </p>
          ) : null}
        </div>
      )}

      <button
        onClick={submit}
        disabled={
          busy ||
          !signedIn ||
          (mode === "link" ? refs.length === 0 : !note.trim() || !canApprove)
        }
        className="mt-5 bg-ink px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-on-ink uppercase disabled:opacity-30"
      >
        {busy ? "posting…" : mode === "link" ? "Submit to the verifier" : "Post write-off"}
      </button>

      {refusal ? (
        <div role="alert" className="mt-4 rounded-[8px] border border-refused/40 bg-white p-4">
          <p className="font-mono text-[10px] tracking-[0.12em] text-refused uppercase">
            the verifier does not agree
          </p>
          <p className="mt-2 max-w-[60ch] font-mono text-[11.5px] leading-relaxed text-ink">
            {refusal.reason}
          </p>
          {refusal.deltaPaise && BigInt(refusal.deltaPaise) !== 0n ? (
            <p className="mt-2 font-mono text-[11.5px] text-refused">
              off by {formatINR(paise(BigInt(refusal.deltaPaise) < 0n ? -BigInt(refusal.deltaPaise) : BigInt(refusal.deltaPaise)))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
