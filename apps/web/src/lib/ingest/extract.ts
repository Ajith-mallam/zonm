// Turn an uploaded file into text units. Dispatches on extension and content.
import type { SourceType } from "@prisma/client";
import { decodeText, normaliseNewlines, paragraphs } from "./decode";
import { parseCsv, parseJson } from "./tabular";
import { ExtractionError, MAX_UNITS, type ExtractOptions, type Extraction, type Unit } from "./types";
import { looksLikeWhatsApp, parseWhatsApp } from "./whatsapp";

export const ACCEPTED_EXTENSIONS = [".txt", ".docx", ".pdf", ".csv", ".json", ".jsonl"] as const;

export function sourceTypeFor(filename: string, head: Uint8Array): SourceType {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  switch (ext) {
    case ".docx":
      return "DOCX";
    case ".pdf":
      return "PDF";
    case ".csv":
      return "CSV";
    case ".json":
    case ".jsonl":
      return "JSON";
    case ".txt": {
      return looksLikeWhatsApp(decodeText(head).text) ? "WHATSAPP" : "TXT";
    }
    default:
      throw new ExtractionError(`Unsupported file type "${ext || filename}". Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}.`);
  }
}

/** Check magic bytes so a renamed file is not parsed as something it is not. */
export function checkSignature(type: SourceType, buf: Uint8Array) {
  if (type === "DOCX" && !(buf[0] === 0x50 && buf[1] === 0x4b)) throw new ExtractionError("This .docx file is not a valid Word document.");
  if (type === "PDF" && Buffer.from(buf.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new ExtractionError("This .pdf file is not a valid PDF.");
}

function asUnits(text: string, split: ExtractOptions["split"]): Unit[] {
  const t = text.trim();
  if (!t) return [];
  return split === "paragraph" ? paragraphs(t) : [{ text: t, position: 1 }];
}

export async function extract(filename: string, buf: Uint8Array, opts: ExtractOptions = {}): Promise<Extraction> {
  const type = sourceTypeFor(filename, buf.subarray(0, 8192));
  checkSignature(type, buf);
  const warnings: string[] = [];
  let result: Extraction;

  switch (type) {
    case "TXT": {
      const { text, encoding } = decodeText(buf);
      if (encoding === "windows-1252") warnings.push("The file was not valid UTF-8 and was read as Windows-1252. Check accented characters in the preview.");
      result = { sourceType: type, units: asUnits(text, opts.split), hasAuthors: false, warnings };
      break;
    }
    case "WHATSAPP": {
      const { text } = decodeText(buf);
      const { units, skipped, dateOrder } = parseWhatsApp(text, opts.tzOffsetMinutes);
      if (skipped) warnings.push(`${skipped} system messages, media placeholders or deleted messages were skipped.`);
      warnings.push(`Dates read as ${dateOrder === "DMY" ? "day/month/year" : "month/day/year"}, local time UTC${fmtOffset(opts.tzOffsetMinutes ?? 240)}.`);
      result = { sourceType: type, units, hasAuthors: true, platform: "WHATSAPP", warnings };
      break;
    }
    case "DOCX": {
      const mammoth = await import("mammoth");
      const { value, messages } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
      if (messages.length) warnings.push(...messages.slice(0, 3).map((m) => `Word: ${m.message}`));
      result = { sourceType: type, units: asUnits(normaliseNewlines(value), opts.split), hasAuthors: false, warnings };
      break;
    }
    case "PDF": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text, totalPages } = await extractText(pdf, { mergePages: false });
      const pages = (text as string[]).map((t) => normaliseNewlines(t).trim());
      if (!pages.some(Boolean)) warnings.push("No text found. The PDF may be a scanned image; OCR is not supported yet.");
      const joined = pages.filter(Boolean).join("\n\n");
      warnings.push(`${totalPages} page(s).`);
      result = { sourceType: type, units: asUnits(joined, opts.split), hasAuthors: false, warnings };
      break;
    }
    case "CSV": {
      const r = parseCsv(decodeText(buf).text, opts);
      result = { sourceType: type, units: r.units, hasAuthors: r.hasAuthors, fields: r.fields, used: r.used, warnings: [...warnings, ...r.warnings] };
      break;
    }
    case "JSON": {
      const r = parseJson(decodeText(buf).text, opts);
      result = { sourceType: type, units: r.units, hasAuthors: r.hasAuthors, fields: r.fields, used: r.used, warnings };
      break;
    }
    default:
      throw new ExtractionError(`Unsupported source type ${type}.`);
  }
  if (result.units.length > MAX_UNITS) {
    throw new ExtractionError(`The file contains ${result.units.length} items; the limit is ${MAX_UNITS}. Split it into smaller files.`);
  }
  return result;
}

function fmtOffset(min: number) {
  const sign = min >= 0 ? "+" : "-";
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
