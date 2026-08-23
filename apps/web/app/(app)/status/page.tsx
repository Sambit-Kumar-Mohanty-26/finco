import { Wrap } from "@/components/layout/Wrap";

/**
 * P0's gate: API time, DB time, deployed SHA — the whole pipeline proved on one
 * page, before any business logic exists. From here on, a failure is a logic
 * failure and never an infrastructure surprise.
 *
 * Rendered fresh on every request; a cached status page is a lie.
 */
export const dynamic = "force-dynamic";

type Health = {
  ok: boolean;
  apiTime: string;
  gitSha: string;
  env: string;
  database: {
    connected: boolean;
    time?: string;
    latencyMs?: number;
    bigintParser?: string;
    bigintRoundTrip?: string;
    reason?: string;
  };
};

async function getHealth(): Promise<Health | { error: string }> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  try {
    const r = await fetch(`${base}/health`, { cache: "no-store" });
    if (!r.ok) return { error: `API responded ${r.status}` };
    return (await r.json()) as Health;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export default async function StatusPage() {
  const h = await getHealth();
  const webTime = new Date().toISOString();
  const failed = "error" in h;

  return (
    <main className="min-h-[100svh] bg-paper py-20">
      <Wrap>
        <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
          P0 · pipeline
        </span>
        <h1 className="mt-5 font-display text-[clamp(32px,4vw,52px)] leading-[1.06] font-normal tracking-[-0.02em]">
          Web, API, database.
        </h1>

        <div className="mt-12 max-w-[760px] overflow-hidden rounded-[12px] border border-line-light bg-white">
          <Row label="Web time" value={webTime} ok />
          {failed ? (
            <Row label="API" value={(h as { error: string }).error} ok={false} />
          ) : (
            <>
              <Row label="API time" value={(h as Health).apiTime} ok />
              <Row
                label="Database time"
                value={
                  (h as Health).database.connected
                    ? `${(h as Health).database.time} · ${(h as Health).database.latencyMs}ms`
                    : ((h as Health).database.reason ?? "unavailable")
                }
                ok={(h as Health).database.connected}
              />
              <Row
                label="int8 parser"
                value={
                  (h as Health).database.bigintParser
                    ? `${(h as Health).database.bigintParser} · ${(h as Health).database.bigintRoundTrip}`
                    : "not checked"
                }
                ok={(h as Health).database.bigintParser === "bigint"}
              />
              <Row label="Deployed SHA" value={(h as Health).gitSha} ok />
              <Row label="Environment" value={(h as Health).env} ok last />
            </>
          )}
        </div>

        <p className="mt-8 max-w-[62ch] text-[15px] leading-[1.6] text-on-paper-hush">
          The <span className="font-mono text-[13px]">int8 parser</span> row is the
          one that matters. Postgres returns bigints as strings by default, and a
          summed money column would then concatenate rather than add — silently,
          and wrong by nine orders of magnitude. It must read{" "}
          <span className="font-mono text-[13px]">bigint</span>.
        </p>
      </Wrap>
    </main>
  );
}

function Row({
  label,
  value,
  ok,
  last = false,
}: {
  label: string;
  value: string;
  ok: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-6 py-4 ${
        last ? "" : "border-b border-line-light"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`h-[7px] w-[7px] rounded-full ${ok ? "bg-signal-deep" : "bg-refused"}`}
        />
        <span className="text-[15px]">{label}</span>
      </span>
      <span className="font-mono text-[12.5px] break-all text-on-paper-hush">
        {value}
      </span>
    </div>
  );
}
