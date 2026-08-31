"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ten seconds to take it back.
 *
 * Undo here is a REVERSAL, not a delete — the API posts a mirror entry beside
 * the original and reopens the exception. So this toast is not hiding a
 * pending write while it waits to see whether you meant it: the posting already
 * happened, and undoing it posts a second one. That is why the window can be
 * short and why the message says "reversed" rather than "cancelled".
 *
 * The countdown is honest about time passing (a person who steps away should
 * not find the offer still open), and hovering pauses it — losing the window
 * because you moved the mouse to reach the button is a cruel way to lose money.
 */
export function UndoToast({
  message,
  seconds = 10,
  onUndo,
  onDismiss,
}: {
  message: string;
  seconds?: number;
  onUndo: () => Promise<void> | void;
  onDismiss: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  const [busy, setBusy] = useState(false);
  const paused = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      if (paused.current) return;
      setLeft((n) => {
        if (n <= 1) {
          clearInterval(t);
          onDismiss();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [onDismiss]);

  return (
    <div
      // polite, not assertive: it interrupts nothing, and it is read after
      // whatever the person was already hearing.
      role="status"
      aria-live="polite"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[10px] border border-line-light bg-ink px-5 py-3 text-on-ink shadow-[var(--shadow-lift)]"
    >
      <span className="font-mono text-[12px]">{message}</span>
      <button
        onClick={async () => {
          setBusy(true);
          await onUndo();
          setBusy(false);
          onDismiss();
        }}
        disabled={busy}
        className="border border-on-ink-hush px-3 py-1 font-mono text-[11px] tracking-[0.06em] uppercase hover:bg-on-ink hover:text-ink disabled:opacity-40"
      >
        {busy ? "reversing…" : `Undo ${left}s`}
      </button>
    </div>
  );
}
