import { describe, expect, it } from "vitest";
import { sha256Hex } from "../text";
import { authorStats, changedSpan, NO_AUTHOR, parseTarget, planImport, targetValue } from "./plan";

const units = [
  { text: "Bonzour tout dimoun", authorLabel: "Marie", position: 1 },
  { text: "Ki manyer?", authorLabel: "Jean", position: 2 },
  { text: "Bonzour tout dimoun", authorLabel: "Marie", position: 3 },
  { text: "Mon la", position: 4 },
];

describe("import planning", () => {
  it("parses and prints targets", () => {
    expect(parseTarget("questioned")).toEqual({ kind: "questioned" });
    expect(parseTarget("known:abc")).toEqual({ kind: "known", candidateId: "abc" });
    expect(parseTarget("known:")).toEqual({ kind: "skip" });
    expect(parseTarget(undefined)).toEqual({ kind: "skip" });
    expect(targetValue({ kind: "known", candidateId: "x" })).toBe("known:x");
  });

  it("summarises authors", () => {
    expect(authorStats(units)).toEqual([
      { author: "Marie", units: 2, words: 6 },
      { author: NO_AUTHOR, units: 1, words: 2 },
      { author: "Jean", units: 1, words: 2 },
    ]);
  });

  it("applies targets and flags duplicates in the case and in the file", () => {
    const existing = new Map([[sha256Hex("Ki manyer?"), "doc-old"]]);
    const plan = planImport(
      units,
      (a) => (a === "Marie" ? { kind: "known", candidateId: "cand-a" } : a === "Jean" ? { kind: "questioned" } : { kind: "skip" }),
      existing,
    );
    expect(plan.map((p) => [p.position, p.role, p.candidateId, p.duplicateOfId, p.duplicateInFile])).toEqual([
      [1, "KNOWN", "cand-a", null, false],
      [2, "QUESTIONED", null, "doc-old", false],
      [3, "KNOWN", "cand-a", null, true],
    ]);
    expect(plan[0].wordCount).toBe(3);
  });
});

describe("changed span", () => {
  it("finds the single edited region", () => {
    expect(changedSpan("Call me on 2512345 tonight", "Call me on [REDACTED] tonight")).toEqual({ start: 11, end: 18, insertedLength: 10 });
    expect(changedSpan("Hello. > quoted text", "Hello.")).toEqual({ start: 6, end: 20, insertedLength: 0 });
    expect(changedSpan("same", "same")).toBeNull();
  });
});
