/**
 * CSV ingest, in the browser.
 *
 * The file never reaches the API as a file. It is parsed here, mapped to the
 * bundle shape `POST /v1/datasets` already accepts, and posted as JSON — so
 * there is no multipart handler, no upload storage, no temp files and no second
 * ingest path to keep in step with the first. The server keeps exactly one
 * mapping from bundle to tables, and it is the one the nightly pull uses too.
 *
 * Everything here is pure, which is the point: `csv.check.mts` runs the whole
 * money path with no browser, no network and no database.
 */

/** One source file, and what it becomes in the bundle. */
export type Kind = "settlements" | "reconRows" | "bankLines" | "erpInvoices";

type Type = "money" | "date" | "text" | "bool";

type Field = {
  key: string;
  type: Type;
  required?: boolean;
  /** Lower-cased header spellings seen in the wild. Matched loosely. */
  aka: string[];
};

/**
 * Column synonyms, not a per-bank switch.
 *
 * Every bank and gateway names these differently and a new one appears every
 * time a customer does. Matching on a synonym list means an unrecognised header
 * is a dropdown the user fixes in ten seconds, rather than a deploy.
 */
export const SCHEMAS: Record<Kind, Field[]> = {
  settlements: [
    { key: "ref", type: "text", required: true, aka: ["settlement id", "settlement", "id", "ref"] },
    { key: "utr", type: "text", aka: ["utr", "utr number", "bank reference", "rrn"] },
    { key: "amountPaise", type: "money", required: true, aka: ["amount", "settlement amount", "net amount", "amount settled"] },
    { key: "feePaise", type: "money", aka: ["fee", "fees", "commission", "mdr"] },
    { key: "taxPaise", type: "money", aka: ["tax", "gst", "tax on fee", "gst on fee"] },
    { key: "settledOn", type: "date", required: true, aka: ["settled on", "settlement date", "created at", "date"] },
    { key: "onHold", type: "bool", aka: ["on hold", "hold", "is on hold"] },
  ],
  reconRows: [
    { key: "entityId", type: "text", required: true, aka: ["entity id", "id", "transaction id"] },
    { key: "type", type: "text", required: true, aka: ["type", "transaction type", "entity type"] },
    { key: "settlementRef", type: "text", aka: ["settlement id", "settlement ref", "settlement"] },
    { key: "orderId", type: "text", aka: ["order id", "order receipt", "receipt"] },
    { key: "paymentId", type: "text", aka: ["payment id", "payment"] },
    { key: "creditPaise", type: "money", aka: ["credit", "amount", "credit amount"] },
    { key: "debitPaise", type: "money", aka: ["debit", "debit amount", "refund amount"] },
    { key: "feePaise", type: "money", aka: ["fee", "fees", "commission", "mdr"] },
    { key: "taxPaise", type: "money", aka: ["tax", "gst", "tax on fee"] },
    { key: "disputeId", type: "text", aka: ["dispute id", "chargeback id"] },
    { key: "description", type: "text", aka: ["description", "narration", "remarks", "notes"] },
    { key: "currency", type: "text", aka: ["currency", "ccy"] },
    { key: "capturedOn", type: "date", aka: ["captured on", "capture date", "transaction date", "date"] },
  ],
  bankLines: [
    { key: "ref", type: "text", required: true, aka: ["ref", "reference", "cheque no", "chq ref no", "transaction id", "utr"] },
    { key: "valueDate", type: "date", required: true, aka: ["value date", "value dt", "date", "transaction date", "txn date", "posting date"] },
    { key: "creditPaise", type: "money", aka: ["credit", "deposit amt", "deposit", "cr", "credit amount", "deposits"] },
    { key: "debitPaise", type: "money", aka: ["debit", "withdrawal amt", "withdrawal", "dr", "debit amount", "withdrawals"] },
    { key: "chargesPaise", type: "money", aka: ["charges", "bank charges"] },
    { key: "narration", type: "text", required: true, aka: ["narration", "description", "particulars", "transaction remarks", "remarks"] },
    { key: "bank", type: "text", aka: ["bank"] },
  ],
  erpInvoices: [
    { key: "invoiceNo", type: "text", required: true, aka: ["invoice no", "invoice number", "voucher no", "bill no", "invoice"] },
    { key: "orderReceipt", type: "text", required: true, aka: ["order receipt", "receipt", "order id", "reference", "order no"] },
    { key: "amountPaise", type: "money", required: true, aka: ["amount", "invoice amount", "gross total", "total", "value"] },
    { key: "invoiceDate", type: "date", aka: ["invoice date", "date", "voucher date"] },
    { key: "customer", type: "text", aka: ["customer", "party", "customer name", "party name", "buyer"] },
  ],
};

/**
 * RFC 4180, near enough: quoted fields may contain commas, newlines and doubled
 * quotes. Written out rather than pulled in, because a dependency for this is
 * thirty lines of behaviour behind forty kilobytes of options nobody sets.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel writes a BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'; // a doubled quote is one literal quote
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\r") continue; // CRLF: the \n below does the work
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // A trailing blank line is the norm in an exported file, not a row of one
  // empty cell. Dropping them here keeps every count downstream honest.
  const clean = rows.filter((r) => r.some((v) => v.trim() !== ""));
  const headers = (clean.shift() ?? []).map((h) => h.trim());
  return { headers, rows: clean };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best-guess header to field mapping. Null means "ask the user". */
export function detectMapping(headers: string[], kind: Kind): Record<string, string | null> {
  const seen = headers.map(norm);
  const out: Record<string, string | null> = {};
  const taken = new Set<number>();

  for (const f of SCHEMAS[kind]) {
    // Exact synonym first, prefix second. Doing it in one pass would let
    // "credit amount" satisfy "credit" before the exact column got a look in.
    let at = seen.findIndex((h, i) => !taken.has(i) && f.aka.includes(h));
    if (at === -1) {
      at = seen.findIndex(
        (h, i) => !taken.has(i) && f.aka.some((a) => h.startsWith(a) || a.startsWith(h)),
      );
    }
    out[f.key] = at === -1 ? null : headers[at]!;
    if (at !== -1) taken.add(at);
  }
  return out;
}

/**
 * Rupees to paise, by string surgery. NEVER through a float.
 *
 * parseFloat("1234.56") * 100 is 123455.99999999999, and Math.round hides that
 * until the day a settlement is off by one paise and an identity refuses to
 * close. Splitting on the decimal point is exact for every input a CSV holds.
 */
export function rupeesToPaise(raw: string): bigint {
  let s = raw.trim().replace(/[₹,\s]/g, "");
  if (s === "" || s === "-") return 0n;

  // Accounting negatives: (1,234.56) and a trailing DR both mean money out.
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/(dr|cr)$/i.test(s)) {
    neg = neg || /dr$/i.test(s);
    s = s.replace(/(dr|cr)$/i, "");
  }
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);

  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) throw new Error(`not an amount: "${raw}"`);
  const frac = m[2] ?? "";
  // Three decimals means the column is not money — a quantity or a rate, mapped
  // by mistake. Rounding it would silently invent a figure.
  if (frac.length > 2) throw new Error(`more than two decimals: "${raw}"`);
  const p = BigInt(m[1] || "0") * 100n + BigInt(frac.padEnd(2, "0") || "0");
  return neg ? -p : p;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Dates to YYYY-MM-DD, without Date.parse.
 *
 * new Date("01/02/2026") is 2 January in one runtime and 1 February in another,
 * and the difference decides which period a settlement lands in. Indian exports
 * are day-first, so that is the assumption — stated here rather than inherited
 * from whichever locale the browser happens to have.
 */
export function toIsoDate(raw: string): string {
  const s = raw.trim();
  if (s === "") throw new Error("empty date");

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;

  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s); // day-first
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;

  m = /^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/.exec(s); // 01-Jun-2026, HDFC's habit
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (mo === -1) throw new Error(`unknown month: "${raw}"`);
    const yr = m[3]!.length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${String(mo + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  throw new Error(`unrecognised date: "${raw}"`);
}

const TRUTHY = new Set(["true", "yes", "y", "1", "on hold", "hold"]);

/**
 * Apply a mapping.
 *
 * Errors carry the row number and the column name, because "invalid CSV" on a
 * 5,000 row file is not something anyone can act on.
 */
export function toBundleRows(
  parsed: { headers: string[]; rows: string[][] },
  kind: Kind,
  mapping: Record<string, string | null>,
): Record<string, unknown>[] {
  const missing = SCHEMAS[kind].filter((f) => f.required && !mapping[f.key]).map((f) => f.key);
  if (missing.length) {
    throw new Error(`unmapped required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  }

  const idx = Object.fromEntries(
    SCHEMAS[kind].map((f) => {
      const name = mapping[f.key];
      return [f.key, name ? parsed.headers.indexOf(name) : -1];
    }),
  );

  return parsed.rows.map((r, n) => {
    const out: Record<string, unknown> = {};
    for (const f of SCHEMAS[kind]) {
      const at = idx[f.key]!;
      const raw = at === -1 ? "" : (r[at] ?? "");
      if (raw.trim() === "") {
        // Row numbers are 1-based and the header is row 1, so a zero-based
        // index of 0 is the file's row 2. Off by one here sends someone to the
        // wrong line of a five thousand row export.
        if (f.required) throw new Error(`row ${n + 2}: ${f.key} is empty`);
        if (f.type === "money") out[f.key] = "0";
        continue; // anything else stays undefined and the server default applies
      }
      try {
        // Money crosses the wire as a decimal string: JSON.stringify throws on
        // a BigInt, and the server converts once at its own boundary.
        if (f.type === "money") out[f.key] = rupeesToPaise(raw).toString();
        else if (f.type === "date") out[f.key] = toIsoDate(raw);
        else if (f.type === "bool") out[f.key] = TRUTHY.has(raw.trim().toLowerCase());
        else out[f.key] = raw.trim();
      } catch (e) {
        throw new Error(`row ${n + 2}, column "${mapping[f.key]}": ${(e as Error).message}`);
      }
    }
    return out;
  });
}

/**
 * The period a bundle belongs to, read off the data rather than asked for.
 *
 * The median date, not the first: one stray 1970 row from a bad parse would
 * otherwise decide the period for the whole file.
 */
export function periodOf(rows: Record<string, unknown>[], dateKey: string): string | null {
  const dates = rows
    .map((r) => String(r[dateKey] ?? ""))
    .filter((d) => /^\d{4}-\d{2}/.test(d))
    .sort();
  return dates.length ? dates[Math.floor(dates.length / 2)]!.slice(0, 7) : null;
}
