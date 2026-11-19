// Text helpers shared by ingestion, seeding and analysis.
import { createHash } from "node:crypto";

/** Words as the engine counts them: letter runs with inner apostrophes or hyphens. */
export function countWords(text: string): number {
  return text.match(/\p{L}+(?:['\u2019-]\p{L}+)*/gu)?.length ?? 0;
}

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : data).digest("hex");

/** A short single-line preview of a text. */
export function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}
