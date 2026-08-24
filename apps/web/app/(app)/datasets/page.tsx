import Link from "next/link";
import { Wrap } from "@/components/layout/Wrap";
import { SeedButton } from "@/components/app/SeedButton";
import { apiGet, isErr, type Dataset } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  const res = await apiGet<{ datasets: Dataset[] }>("/v1/datasets");

  return (
    <main className="py-16">
      <Wrap>
        <span className="block font-mono text-[11px] font-semibold tracking-[0.16em] text-signal-deep uppercase">
          P1 · ingest
        </span>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-[clamp(30px,4vw,46px)] leading-[1.06] font-normal tracking-[-0.02em]">
              Three sources in, one table out.
            </h1>
            <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-hush">
              Razorpay recon rows, the bank statement and the ERP invoice register, ingested
              together and browsable to the paise. No matching yet — this proves the pipeline
              carries money correctly under real volume.
            </p>
          </div>
          <SeedButton />
        </div>

        {isErr(res) ? (
          <Empty title="The API is not answering." detail={res.error} />
        ) : res.datasets.length === 0 ? (
          <Empty
            title="No datasets yet."
            detail="Seed a scenario to get started — 500 rows runs synchronously, 5,000 needs P3."
          />
        ) : (
          <div className="mt-12 overflow-hidden rounded-[12px] border border-line-light bg-white">
            {res.datasets.map((d, i) => (
              <Link
                key={d.id}
                href={`/datasets/${d.id}`}
                className={`flex flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4 transition-colors hover:bg-paper ${
                  i > 0 ? "border-t border-line-light" : ""
                }`}
              >
                <span className="min-w-[220px] flex-1 text-[15px] text-ink">{d.name}</span>
                <Count n={d.counts.reconRows} label="recon" />
                <Count n={d.counts.settlements} label="settlements" />
                <Count n={d.counts.bankLines} label="bank" />
                <Count n={d.counts.erpInvoices} label="invoices" />
                <span className="font-mono text-[11px] text-ink-hush">{d.period}</span>
              </Link>
            ))}
          </div>
        )}
      </Wrap>
    </main>
  );
}

function Count({ n, label }: { n?: number; label: string }) {
  return (
    <span className="font-mono text-[12px] tnum text-ink-hush">
      <span className="text-ink">{(n ?? 0).toLocaleString("en-IN")}</span> {label}
    </span>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-12 rounded-[12px] border border-dashed border-line-light px-8 py-14 text-center">
      <p className="text-[16px] text-ink">{title}</p>
      <p className="mt-2 font-mono text-[12px] text-ink-hush">{detail}</p>
    </div>
  );
}
