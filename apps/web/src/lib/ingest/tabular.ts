// CSV and JSON ingestion: one unit per row / record. Field names are detected
// from common conventions (including Apify Facebook/Instagram/TikTok output)
// and can be overridden.
import Papa from "papaparse";
import { ExtractionError, type Unit } from "./types";

type Row = Record<string, unknown>;

const CANDIDATES = {
  text: ["text", "message", "content", "body", "caption", "post_text", "posttext", "comment", "description", "full_text"],
  author: ["author", "from", "sender", "username", "ownerusername", "authorname", "author.name", "user.name", "user", "name", "profilename", "authormeta.name"],
  date: ["date", "timestamp", "time", "createdat", "created_at", "publishedat", "postedat", "taken_at_timestamp", "createtime", "createtimeiso", "time_iso"],
  id: ["id", "postid", "messageid", "shortcode", "post_id"],
  url: ["url", "posturl", "link", "permalink", "weburl", "facebookurl"],
};

/** Flatten nested objects one or two levels deep into dotted keys. */
function flatten(obj: Row, prefix = "", depth = 0, out: Row = {}): Row {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) flatten(v as Row, key, depth + 1, out);
    else out[key] = v;
  }
  return out;
}

function detect(fields: string[], kind: keyof typeof CANDIDATES): string | undefined {
  const lower = new Map(fields.map((f) => [f.toLowerCase(), f]));
  for (const c of CANDIDATES[kind]) if (lower.has(c)) return lower.get(c);
  return undefined;
}

export function parseDate(v: unknown): Date | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string") {
    if (/^\d{9,13}$/.test(v)) return parseDate(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : new Date(t);
  }
  return undefined;
}

const str = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

function rowsToUnits(rows: Row[], fields: string[], opts: { textField?: string; authorField?: string; dateField?: string }) {
  const textField = opts.textField || detect(fields, "text");
  if (!textField || !fields.includes(textField)) {
    throw new ExtractionError(`Could not find the text column. Available: ${fields.slice(0, 20).join(", ")}`, fields);
  }
  const authorField = opts.authorField === "" ? undefined : opts.authorField || detect(fields, "author");
  const dateField = opts.dateField === "" ? undefined : opts.dateField || detect(fields, "date");
  const idField = detect(fields, "id");
  const urlField = detect(fields, "url");
  const units: Unit[] = [];
  rows.forEach((r, i) => {
    const text = str(r[textField]).replace(/\r\n?/g, "\n").trim();
    if (!text) return;
    units.push({
      text,
      authorLabel: authorField ? str(r[authorField]).trim() || undefined : undefined,
      authoredAt: dateField ? parseDate(r[dateField]) : undefined,
      externalId: idField ? str(r[idField]) || undefined : undefined,
      sourceUrl: urlField && /^https?:\/\//.test(str(r[urlField])) ? str(r[urlField]) : undefined,
      position: i + 1,
    });
  });
  return { units, used: { textField, authorField, dateField }, hasAuthors: !!authorField };
}

export function parseCsv(text: string, opts: { textField?: string; authorField?: string; dateField?: string } = {}) {
  const res = Papa.parse<Row>(text, { header: true, skipEmptyLines: "greedy", dynamicTyping: false });
  if (!res.meta.fields?.length) throw new ExtractionError("The CSV file has no header row.");
  const fields = res.meta.fields;
  const warnings = res.errors.slice(0, 5).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  return { ...rowsToUnits(res.data, fields, opts), fields, warnings };
}

/** Find the records in a JSON document: an array, or the first array of objects inside an object. */
function findRecords(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter((x): x is Row => !!x && typeof x === "object" && !Array.isArray(x));
  if (data && typeof data === "object") {
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.some((x) => x && typeof x === "object")) return findRecords(v);
    }
    return [data as Row];
  }
  return [];
}

export function parseJson(text: string, opts: { textField?: string; authorField?: string; dateField?: string } = {}) {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // JSON Lines: one object per line.
    const lines = text.split("\n").filter((l) => l.trim());
    try {
      data = lines.map((l) => JSON.parse(l));
    } catch {
      throw new ExtractionError(`Not valid JSON: ${(e as Error).message}`);
    }
  }
  const rows = findRecords(data).map((r) => flatten(r));
  if (!rows.length) throw new ExtractionError("No records found in the JSON file.");
  const fields = [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))].filter((f) =>
    rows.slice(0, 200).some((r) => ["string", "number"].includes(typeof r[f])),
  );
  return { ...rowsToUnits(rows, fields, opts), fields, warnings: [] as string[] };
}
