// Import planning: map extracted units to document roles and candidates,
// detect duplicates, and summarise per author. Pure apart from the duplicate
// lookup, which the caller supplies.
import type { DocumentRole } from "@prisma/client";
import { countWords, sha256Hex } from "../text";
import type { Unit } from "./types";

export const NO_AUTHOR = "(no author)";

/** Where an author's (or a whole file's) units go. */
export type Target = { kind: "skip" } | { kind: "questioned" } | { kind: "known"; candidateId: string };

export function parseTarget(v: string | null | undefined): Target {
  if (!v || v === "skip") return { kind: "skip" };
  if (v === "questioned") return { kind: "questioned" };
  if (v.startsWith("known:") && v.length > 6) return { kind: "known", candidateId: v.slice(6) };
  return { kind: "skip" };
}

export const targetValue = (t: Target) => (t.kind === "known" ? `known:${t.candidateId}` : t.kind);

export type AuthorStat = { author: string; units: number; words: number };

export function authorStats(units: Unit[]): AuthorStat[] {
  const m = new Map<string, AuthorStat>();
  for (const u of units) {
    const a = u.authorLabel || NO_AUTHOR;
    const s = m.get(a) ?? { author: a, units: 0, words: 0 };
    s.units++;
    s.words += countWords(u.text);
    m.set(a, s);
  }
  return [...m.values()].sort((x, y) => y.units - x.units || x.author.localeCompare(y.author));
}

export type PlannedDoc = Unit & {
  role: DocumentRole;
  candidateId: string | null;
  sha256: string;
  wordCount: number;
  duplicateOfId: string | null;
  duplicateInFile: boolean;
};

/**
 * Decide each unit's role and candidate from the per-author targets (or the
 * single file target), and mark duplicates: same text already in the case
 * (``existing``: sha256 -> document id) or earlier in the same file.
 */
export function planImport(units: Unit[], targetFor: (author: string) => Target, existing: Map<string, string>): PlannedDoc[] {
  const seen = new Set<string>();
  const out: PlannedDoc[] = [];
  for (const u of units) {
    const t = targetFor(u.authorLabel || NO_AUTHOR);
    if (t.kind === "skip") continue;
    const sha256 = sha256Hex(u.text);
    out.push({
      ...u,
      role: t.kind === "questioned" ? "QUESTIONED" : "KNOWN",
      candidateId: t.kind === "known" ? t.candidateId : null,
      sha256,
      wordCount: countWords(u.text),
      duplicateOfId: existing.get(sha256) ?? null,
      duplicateInFile: seen.has(sha256),
    });
    seen.add(sha256);
  }
  return out;
}

/** The single changed region between two versions of a text. */
export function changedSpan(before: string, after: string): { start: number; end: number; insertedLength: number } | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  return { start, end: endB, insertedLength: endA - start };
}
