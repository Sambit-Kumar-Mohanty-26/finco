"use client";

import { formatINR, paise } from "@finco/core";
import { Money } from "@/components/money/Money";

/**
 * Choose which settlements a merged bank credit is made of.
 *
 * A merged credit is one line in the statement and several settlements in the
 * gateway, and T3 refuses it whenever more than one subset adds up — because
 * adding up is not the same as being the only thing that adds up. When T3
 * refuses, this is how a person answers the question instead.
 *
 * The running delta is shown live and NOT used as a gate. The verifier is the
 * gate, and it is the same verifier that judged T3: a selection that reaches
 * zero here is still sent to the API and can still be rejected there, with the
 * reason shown. A UI that decided for itself what "closes" would be a second
 * implementation of the identity, waiting to disagree with the first.
 */

export type Candidate = { ref: string; amountPaise: string; note?: string };

export function SubsetPicker({
  candidates,
  targetPaise,
  selected,
  onChange,
}: {
  candidates: Candidate[];
  targetPaise: string;
  selected: string[];
  onChange: (refs: string[]) => void;
}) {
  const sum = selected.reduce(
    (a, ref) => a + BigInt(candidates.find((c) => c.ref === ref)?.amountPaise ?? "0"),
    0n,
  );
  const delta = sum - BigInt(targetPaise);

  const toggle = (ref: string) =>
    onChange(selected.includes(ref) ? selected.filter((r) => r !== ref) : [...selected, ref]);

  return (
    <div className="rounded-[10px] border border-line-light bg-white">
      <div className="flex items-baseline justify-between border-b border-line-light px-4 py-2.5">
        <span className="font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
          settlements in this credit
        </span>
        <span className="font-mono text-[11px] text-ink-hush">
          target <Money paise={paise(targetPaise)} className="text-[11px] text-ink" />
        </span>
      </div>

      <ul className="max-h-[280px] overflow-y-auto">
        {candidates.length === 0 ? (
          <li className="px-4 py-6 text-center font-mono text-[11px] text-ink-hush">
            No unconsumed settlement in this window.
          </li>
        ) : (
          candidates.map((c) => {
            const on = selected.includes(c.ref);
            return (
              <li key={c.ref} className="border-b border-line-light last:border-b-0">
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-paper">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(c.ref)}
                    className="accent-[var(--color-signal-deep)]"
                  />
                  <span className="flex-1 font-mono text-[12px]">{c.ref}</span>
                  {c.note ? (
                    <span className="font-mono text-[10.5px] text-ink-hush">{c.note}</span>
                  ) : null}
                  <Money paise={paise(c.amountPaise)} className="text-[12px]" />
                </label>
              </li>
            );
          })
        )}
      </ul>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-line-light px-4 py-2.5">
        <span className="font-mono text-[11px] text-ink-hush">
          {selected.length} selected · <Money paise={paise(sum)} className="text-[11px] text-ink" />
        </span>
        <span
          className={`font-mono text-[12px] tnum ${delta === 0n ? "text-signal-deep" : "text-refused"}`}
        >
          {delta === 0n ? "delta 0.00" : `delta ${delta > 0n ? "+" : "−"}${formatINR(paise(delta < 0n ? -delta : delta))}`}
        </span>
      </div>
    </div>
  );
}
