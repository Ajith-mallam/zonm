// Server-side evidence helpers shared by the upload/download routes, the
// import preview and the import action.
import type { SourceFile } from "@prisma/client";
import { prisma } from "./db";
import { extract } from "./ingest/extract";
import type { ExtractOptions } from "./ingest/types";
import { readEvidence } from "./storage";
import { sha256Hex } from "./text";

export class IntegrityError extends Error {}

/** Read a stored file and confirm it still matches the hash recorded at upload. */
export async function readVerified(file: Pick<SourceFile, "id" | "storagePath" | "sha256">): Promise<Buffer> {
  const bytes = await readEvidence(file.storagePath, file.id);
  if (sha256Hex(bytes) !== file.sha256) throw new IntegrityError(`Stored file ${file.id} does not match its recorded SHA-256.`);
  return bytes;
}

export async function extractSourceFile(file: SourceFile, opts: ExtractOptions) {
  return extract(file.filename, await readVerified(file), opts);
}

/** sha256 -> earliest document id, for duplicate detection within a case. */
export async function caseTextHashes(caseId: string): Promise<Map<string, string>> {
  const rows = await prisma.document.findMany({ where: { caseId }, select: { id: true, sha256: true }, orderBy: { createdAt: "asc" } });
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.sha256)) m.set(r.sha256, r.id);
  return m;
}

/** Parse the extraction options carried in a query string or form. */
export function extractOptionsFrom(get: (k: string) => string | null | undefined): ExtractOptions {
  const v = (k: string) => {
    const x = get(k);
    return typeof x === "string" ? x : undefined;
  };
  return {
    split: v("split") === "paragraph" ? "paragraph" : "none",
    textField: v("textField") || undefined,
    authorField: v("authorField"),
    dateField: v("dateField"),
  };
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
