import { describe, expect, it } from "vitest";
import { corpusSufficiency, nextPseudonym, normaliseHandle } from "./candidates";

describe("corpus sufficiency", () => {
  it.each([
    [0, "none", 0],
    [400, "insufficient", 8],
    [999, "insufficient", 20],
    [1000, "limited", 20],
    [4999, "limited", 100],
    [5000, "good", 100],
    [20000, "good", 100],
  ] as const)("%i words -> %s", (words, level, percent) => {
    const s = corpusSufficiency(words, 3);
    expect(s.level).toBe(level);
    expect(s.percent).toBe(percent);
  });

  it("says how many words are missing", () => {
    expect(corpusSufficiency(400, 2).message).toBe("600 more words needed before analysis.");
  });
});

describe("pseudonyms", () => {
  it("takes the first free letter", () => {
    expect(nextPseudonym([])).toBe("Candidate A");
    expect(nextPseudonym(["Candidate A", "candidate b"])).toBe("Candidate C");
    expect(nextPseudonym(["Candidate B"])).toBe("Candidate A");
  });

  it("continues past Z", () => {
    const az = Array.from({ length: 26 }, (_, i) => `Candidate ${String.fromCharCode(65 + i)}`);
    expect(nextPseudonym(az)).toBe("Candidate AA");
    expect(nextPseudonym([...az, "Candidate AA"])).toBe("Candidate AB");
  });
});

describe("handles", () => {
  it("normalises per platform", () => {
    expect(normaliseHandle("INSTAGRAM", " @sey.voice ")).toBe("sey.voice");
    expect(normaliseHandle("EMAIL", "Jane@Mail.SC")).toBe("jane@mail.sc");
    expect(normaliseHandle("PHONE", "+248 2 52 12 34")).toBe("+2482521234");
  });
});
