/**
 * A bank narration, with the parts a tier reads marked.
 *
 * A narration is the only free text in the whole pipeline and it is the one
 * place a reviewer has to read character by character — "is that UTR truncated,
 * or is it a different UTR?" is a question you cannot answer from a paraphrase.
 * So the raw string is always shown in full and the highlight is additive: the
 * spans mark what T1 matched on, they never replace, reorder or elide anything.
 *
 * The text is rendered as TEXT. It arrives from a bank statement a stranger can
 * influence, so it goes through JSX children — never dangerouslySetInnerHTML,
 * and never into an attribute that a browser would execute.
 */

import { splitNarration } from "@/lib/review";

export function NarrationHighlight({
  text,
  match,
  className = "",
}: {
  text: string;
  /** The token a tier actually joined on, emphasised above the rest. */
  match?: string | null;
  className?: string;
}) {
  const parts = splitNarration(text);
  return (
    <span className={`font-mono text-[11.5px] leading-relaxed break-all ${className}`}>
      {parts.map((p, i) =>
        // split() with one capture group puts the captures at odd indices.
        i % 2 === 1 ? (
          <mark
            key={i}
            className={
              match && p === match
                ? "bg-signal-wash px-[2px] text-signal-deep"
                : "bg-transparent px-[2px] text-ink underline decoration-line-light decoration-dotted underline-offset-2"
            }
          >
            {p}
          </mark>
        ) : (
          <span key={i} className="text-ink-hush">
            {p}
          </span>
        ),
      )}
    </span>
  );
}
