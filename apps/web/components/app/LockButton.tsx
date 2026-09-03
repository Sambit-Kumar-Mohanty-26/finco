"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/api";
import { useMe } from "@/lib/useMe";

/**
 * Close the books, or reopen them.
 *
 * The button is disabled when the checklist does not pass, and the API refuses
 * as well — a lock you can force past a failing check is a button, not a
 * control. The reopen is deliberately kept: a lock nobody can reverse gets
 * worked around by posting into the wrong month, which is worse.
 */
export function LockButton({
  period,
  locked,
  ready,
}: {
  period: string;
  locked: boolean;
  ready: boolean;
}) {
  const router = useRouter();
  const { me } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  const mayLock = me?.role === "approver";

  async function send(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const r = await apiSend(path, body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setReopening(false);
    router.refresh();
  }

  if (locked) {
    return (
      <div className="text-right">
        {reopening ? (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
              void send(`/v1/periods/${period}/reopen`, { reason });
            }}
          >
            <input
              name="reason"
              placeholder="Why reopen? A reviewer reads this later."
              className="min-w-0 flex-1 border-b border-line-light bg-transparent pb-1 text-[13px] outline-none focus:border-refused"
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 border border-refused px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-refused uppercase disabled:opacity-40"
            >
              Reopen
            </button>
          </form>
        ) : (
          <button
            type="button"
            disabled={!mayLock}
            onClick={() => setReopening(true)}
            className="font-mono text-[11px] tracking-[0.06em] text-ink-hush uppercase underline disabled:opacity-40"
          >
            Reopen {period}
          </button>
        )}
        {error ? <p className="mt-2 font-mono text-[11px] text-refused">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={!mayLock || !ready || busy}
        onClick={() => void send(`/v1/periods/${period}/lock`)}
        className="bg-ink px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-on-ink uppercase transition-opacity hover:opacity-90 disabled:opacity-30"
      >
        {busy ? "locking…" : `Lock ${period}`}
      </button>
      <p className="mt-2 max-w-[280px] font-mono text-[10.5px] leading-relaxed text-ink-hush">
        {!mayLock
          ? "Locking needs the approver role."
          : ready
            ? "Every item below passes."
            : "Blocked until every item below passes."}
      </p>
      {error ? <p className="mt-2 max-w-[280px] font-mono text-[11px] text-refused">{error}</p> : null}
    </div>
  );
}
