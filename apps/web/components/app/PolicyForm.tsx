"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatINR, paise } from "@finco/core";
import { apiSend, type EffectivePolicy } from "@/lib/api";
import { useMe } from "@/lib/useMe";

/**
 * The four numbers that decide what posts without a person.
 *
 * Autonomy is a three-position control rather than a checkbox because the
 * middle position is the one a finance team actually lives in for months, and a
 * boolean forces them to choose between "off" and "trust it completely" on day
 * one. The positions are labelled with what they DO, not with adjectives.
 */

const MODES = [
  {
    key: "observe",
    label: "Observe",
    blurb: "Reconciles and reports. Posts nothing at all — every outcome goes to review.",
  },
  {
    key: "assist",
    label: "Assist",
    blurb: "Posts what it can prove below the cap. Anything above it, or unproven, waits for a signature.",
  },
  {
    key: "auto",
    label: "Auto",
    blurb: "Same as assist today. The cap still applies: a mode is not permission to skip materiality.",
  },
] as const;

const rupees = (p: string) => (Number(BigInt(p)) / 100).toString();
const toPaise = (r: string) => BigInt(Math.round(Number(r || "0") * 100)).toString();

export function PolicyForm({ initial }: { initial: EffectivePolicy }) {
  const router = useRouter();
  const { me } = useMe();
  const [policy, setPolicy] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mayEdit = me?.role === "approver";

  async function save(patch: Partial<EffectivePolicy>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const next = { ...policy, ...patch };
    const r = await apiSend<EffectivePolicy>("/v1/settings/policy", {
      autonomyCapPaise: next.autonomyCapPaise,
      materialityPaise: next.materialityPaise,
      cashFloorPaise: next.cashFloorPaise,
      suspenseCeilingPaise: next.suspenseCeilingPaise,
      autonomyMode: next.autonomyMode,
      killSwitch: next.killSwitch,
      killReason: next.killReason,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPolicy(r.data);
    setSaved(true);
    // The banner lives in the layout, so a kill-switch change has to re-render
    // more than this form.
    router.refresh();
  }

  return (
    <div className="mt-8 space-y-8">
      {!mayEdit ? (
        <p className="font-mono text-[11.5px] text-ink-hush">
          Read-only: changing policy needs the approver role. The API refuses regardless of what this
          page shows.
        </p>
      ) : null}

      {/* --- autonomy ------------------------------------------------------ */}
      <fieldset disabled={!mayEdit || busy} className="disabled:opacity-60">
        <legend className="font-mono text-[10px] tracking-[0.14em] text-ink-hush uppercase">
          Autonomy
        </legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => {
            const on = policy.autonomyMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={on}
                onClick={() => save({ autonomyMode: m.key })}
                className={`rounded-[10px] border px-4 py-3 text-left transition-colors ${
                  on ? "border-signal-deep bg-signal-wash" : "border-line-light bg-white hover:border-ink/20"
                }`}
              >
                <span className="block text-[14px] font-medium">{m.label}</span>
                <span className="mt-1 block text-[12px] leading-[1.45] text-ink-hush">{m.blurb}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* --- the money limits ---------------------------------------------- */}
      <fieldset disabled={!mayEdit || busy} className="disabled:opacity-60">
        <legend className="font-mono text-[10px] tracking-[0.14em] text-ink-hush uppercase">
          Limits, in rupees
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["autonomyCapPaise", "Autonomy cap", "A model claim at or above this waits for a signature, even when the verifier proved it."],
              ["materialityPaise", "Materiality", "A residual smaller than this is absorbed rather than parked."],
              ["cashFloorPaise", "Cash floor", "The p10 cumulative is judged against this on the cash page."],
              ["suspenseCeilingPaise", "Suspense ceiling", "A run that parks more than this fires an alert. Suspense is a waiting room, not an account."],
            ] as const
          ).map(([key, label, why]) => (
            <label key={key} className="block rounded-[10px] border border-line-light bg-white px-4 py-3">
              <span className="block text-[13.5px] font-medium">{label}</span>
              <input
                type="number"
                min="0"
                step="1"
                defaultValue={rupees(policy[key])}
                onBlur={(e) => {
                  const v = toPaise(e.target.value);
                  if (v !== policy[key]) void save({ [key]: v } as Partial<EffectivePolicy>);
                }}
                className="mt-2 w-full border-b border-line-light bg-transparent pb-1 font-mono text-[15px] tnum outline-none focus:border-signal-deep"
              />
              <span className="mt-1.5 block font-mono text-[10px] text-ink-hush">
                {formatINR(paise(policy[key]))}
              </span>
              <span className="mt-1.5 block text-[11.5px] leading-[1.4] text-ink-hush">{why}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* --- the kill switch ------------------------------------------------ */}
      <fieldset
        disabled={!mayEdit || busy}
        className={`rounded-[10px] border px-5 py-4 disabled:opacity-60 ${
          policy.killSwitch ? "border-refused bg-refused/[0.06]" : "border-line-light bg-white"
        }`}
      >
        <legend className="px-1 font-mono text-[10px] tracking-[0.14em] text-ink-hush uppercase">
          Kill switch
        </legend>
        <p className="text-[13px] leading-[1.5] text-ink-hush">
          Turns off every automatic posting at every tier, deterministic ones included, and puts a
          banner on every screen. A switch with an exception list is a setting, not a switch.
        </p>
        {policy.killSwitch ? (
          <button
            type="button"
            onClick={() => void save({ killSwitch: false, killReason: "" })}
            className="mt-3 bg-ink px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-on-ink uppercase"
          >
            Turn off
          </button>
        ) : (
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
              if (!reason) return setError("say why — it appears on every screen");
              void save({ killSwitch: true, killReason: reason });
            }}
          >
            <input
              name="reason"
              placeholder="Why? e.g. gateway feed looks wrong since 04:00"
              className="min-w-0 flex-1 border-b border-line-light bg-transparent pb-1 text-[13.5px] outline-none focus:border-refused"
            />
            <button
              type="submit"
              className="shrink-0 border border-refused px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-refused uppercase"
            >
              Turn on
            </button>
          </form>
        )}
        {policy.killSwitch && policy.killReason ? (
          <p className="mt-2 font-mono text-[11px] text-refused">reason: {policy.killReason}</p>
        ) : null}
      </fieldset>

      <p className="font-mono text-[11px] text-ink-hush">
        {error ? <span className="text-refused">{error}</span> : null}
        {!error && saved ? "saved — the change is in the audit chain" : null}
        {!error && !saved && policy.updatedAt ? `last changed ${policy.updatedAt.slice(0, 16).replace("T", " ")}` : null}
      </p>
    </div>
  );
}
