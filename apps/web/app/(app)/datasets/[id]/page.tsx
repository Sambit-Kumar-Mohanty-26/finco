import Link from "next/link";
import { notFound } from "next/navigation";
import { Wrap } from "@/components/layout/Wrap";
import { RowTable } from "@/components/app/RowTable";
import { RunButton } from "@/components/app/RunButton";
import { apiGet, isErr, type Dataset } from "@/lib/api";

type RowPage = { rows: (Record<string, unknown> & { id: string })[]; nextCursor: string | null };

export const dynamic = "force-dynamic";

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // First page server-side: it lands in the SSR HTML, so the table has content
  // before any JavaScript runs and the client needs no mount effect.
  const [ds, first] = await Promise.all([
    apiGet<Dataset>(`/v1/datasets/${id}`),
    apiGet<RowPage>(`/v1/datasets/${id}/rows?source=recon&limit=200`),
  ]);
  if (isErr(ds)) {
    if (ds.error.includes("404")) notFound();
    return (
      <main className="py-16">
        <Wrap>
          <p className="font-mono text-[13px] text-refused">{ds.error}</p>
        </Wrap>
      </main>
    );
  }

  const rows = ds.counts.reconRows ?? 0;

  return (
    <main className="py-14">
      <Wrap>
        <Link href="/datasets" className="font-mono text-[11px] text-ink-hush hover:text-ink">
          ← Datasets
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-[clamp(26px,3vw,38px)] leading-[1.1] tracking-[-0.02em]">
              {ds.name}
            </h1>
            <p className="mt-2 font-mono text-[12px] text-ink-hush">
              {ds.period} · {rows.toLocaleString("en-IN")} recon rows ·{" "}
              {(ds.counts.settlements ?? 0).toLocaleString("en-IN")} settlements ·{" "}
              {(ds.counts.bankLines ?? 0).toLocaleString("en-IN")} bank lines ·{" "}
              {(ds.counts.erpInvoices ?? 0).toLocaleString("en-IN")} invoices
            </p>
          </div>
          <RunButton datasetId={ds.id} rows={rows} />
        </div>

        <div className="mt-10">
          <RowTable
            datasetId={ds.id}
            initialRows={isErr(first) ? [] : first.rows}
            initialCursor={isErr(first) ? null : first.nextCursor}
          />
        </div>
      </Wrap>
    </main>
  );
}
