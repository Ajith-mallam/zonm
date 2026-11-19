import { describe, expect, it } from "vitest";
import { countWords, sha256Hex } from "../text";
import { decodeText, paragraphs } from "./decode";
import { extract } from "./extract";
import { buildDocx, buildPdf, WHATSAPP_ANDROID, WHATSAPP_IOS } from "./fixtures";
import { parseDate } from "./tabular";
import { ExtractionError } from "./types";
import { looksLikeWhatsApp, parseWhatsApp } from "./whatsapp";

const enc = (s: string) => new TextEncoder().encode(s);

describe("text decoding", () => {
  it("handles UTF-8 with BOM, UTF-16 and Windows-1252, and normalises newlines", () => {
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc("Zot\r\nla")])).text).toBe("Zot\nla");
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Kréol", "utf16le")]);
    expect(decodeText(utf16).text).toBe("Kréol");
    const cp1252 = decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Windows-1252
    expect(cp1252).toEqual({ text: "café", encoding: "windows-1252" });
  });

  it("splits paragraphs on blank lines", () => {
    expect(paragraphs("one\n\n\n two \n\nthree").map((p) => p.text)).toEqual(["one", "two", "three"]);
  });
});

describe("whatsapp", () => {
  it("detects exports", () => {
    expect(looksLikeWhatsApp(WHATSAPP_ANDROID)).toBe(true);
    expect(looksLikeWhatsApp("Just an ordinary letter.\nDear Sir,")).toBe(false);
  });

  it("parses Android exports: senders, continuation lines, placeholders, system lines", () => {
    const { units, skipped } = parseWhatsApp(WHATSAPP_ANDROID);
    expect(units.map((u) => [u.authorLabel, u.text])).toEqual([
      ["Marie", "Bonzour tout dimoun!"],
      ["Jean-Paul", "Ki manyer?\nMon pe vini aswar."],
      ["Ravi", "Morning all"],
    ]);
    expect(skipped).toBe(4); // encryption notice, media, deleted, "added"
    // 10:15 in Seychelles (UTC+4) is 06:15 UTC
    expect(units[0].authoredAt?.toISOString()).toBe("2026-11-19T06:15:00.000Z");
  });

  it("parses iOS exports with 12-hour times", () => {
    const { units } = parseWhatsApp(WHATSAPP_IOS, 0);
    expect(units).toHaveLength(2);
    expect(units[0].authoredAt?.toISOString()).toBe("2026-02-03T20:05:09.000Z");
  });

  it("works out month/day order", () => {
    const us = "11/19/2026, 10:15 - A: hi\n11/20/2026, 10:15 - A: again";
    expect(parseWhatsApp(us, 0).dateOrder).toBe("MDY");
    expect(parseWhatsApp(us, 0).units[0].authoredAt?.toISOString()).toBe("2026-11-19T10:15:00.000Z");
  });
});

describe("extract", () => {
  it("reads plain text as one document or split into paragraphs", async () => {
    const buf = enc("First paragraph here.\n\nSecond one.");
    expect((await extract("letter.txt", buf)).units).toHaveLength(1);
    const split = await extract("letter.txt", buf, { split: "paragraph" });
    expect(split.units.map((u) => u.text)).toEqual(["First paragraph here.", "Second one."]);
    expect(split.sourceType).toBe("TXT");
  });

  it("recognises a WhatsApp export saved as .txt", async () => {
    const r = await extract("WhatsApp Chat with Group.txt", enc(WHATSAPP_ANDROID));
    expect(r.sourceType).toBe("WHATSAPP");
    expect(r.hasAuthors).toBe(true);
    expect(r.platform).toBe("WHATSAPP");
  });

  it("reads Word documents", async () => {
    const r = await extract("statement.docx", await buildDocx(["Mon pa konnen.", "Zot pa ti dir nou."]), { split: "paragraph" });
    expect(r.sourceType).toBe("DOCX");
    expect(r.units.map((u) => u.text)).toEqual(["Mon pa konnen.", "Zot pa ti dir nou."]);
  });

  it("reads PDFs", async () => {
    const r = await extract("letter.pdf", buildPdf(["The room was not as advertised.", "Je ne reviendrai pas."]));
    expect(r.sourceType).toBe("PDF");
    expect(r.units[0].text).toContain("The room was not as advertised.");
    expect(r.units[0].text).toContain("reviendrai");
  });

  it("reads CSV with detected columns, quoted newlines and dates", async () => {
    const csv = 'id,author,date,message\n1,Marie,2026-03-04T10:00:00Z,"Line one\nline two"\n2,Jean,2026-03-05,"Hello, world"\n3,Jean,,\n';
    const r = await extract("posts.csv", enc(csv));
    expect(r.used).toEqual({ textField: "message", authorField: "author", dateField: "date" });
    expect(r.units).toHaveLength(2); // empty row skipped
    expect(r.units[0]).toMatchObject({ text: "Line one\nline two", authorLabel: "Marie", externalId: "1" });
    expect(r.units[0].authoredAt?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
  });

  it("lets the user choose CSV columns, and explains a missing text column", async () => {
    const csv = "who,said\nA,hello there\n";
    await expect(extract("x.csv", enc(csv))).rejects.toThrow(/text column.*who, said/);
    const r = await extract("x.csv", enc(csv), { textField: "said", authorField: "who" });
    expect(r.units[0]).toMatchObject({ text: "hello there", authorLabel: "A" });
  });

  it("reads Apify-style JSON with nested authors and epoch timestamps", async () => {
    const json = JSON.stringify([
      { postId: "p1", text: "Sa lakaz la i sal!!!", user: { name: "jp.lafors.92" }, timestamp: 1767225600, url: "https://facebook.com/p/1" },
      { postId: "p2", text: "", user: { name: "x" } },
    ]);
    const r = await extract("dataset.json", enc(json));
    expect(r.used?.textField).toBe("text");
    expect(r.used?.authorField).toBe("user.name");
    expect(r.units).toEqual([
      { text: "Sa lakaz la i sal!!!", authorLabel: "jp.lafors.92", authoredAt: new Date("2026-01-01T00:00:00Z"), externalId: "p1", sourceUrl: "https://facebook.com/p/1", position: 1 },
    ]);
  });

  it("reads JSON Lines and records wrapped in an object", async () => {
    expect((await extract("a.jsonl", enc('{"text":"one"}\n{"text":"two"}'))).units).toHaveLength(2);
    expect((await extract("b.json", enc('{"meta":1,"items":[{"content":"x y"}]}'))).units[0].text).toBe("x y");
  });

  it("rejects unsupported and disguised files", async () => {
    await expect(extract("photo.jpg", enc("x"))).rejects.toBeInstanceOf(ExtractionError);
    await expect(extract("fake.pdf", enc("hello"))).rejects.toThrow(/not a valid PDF/);
    await expect(extract("fake.docx", enc("hello"))).rejects.toThrow(/not a valid Word/);
  });
});

describe("helpers", () => {
  it("counts words like the engine", () => {
    expect(countWords("Mon pa'n konnen, zot pe vini!! 😂 l'eau 2026")).toBe(7); // Mon pa'n konnen zot pe vini l'eau
  });

  it("hashes text as UTF-8", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("parses dates in common forms", () => {
    expect(parseDate(1767225600)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseDate("1767225600000")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseDate("not a date")).toBeUndefined();
  });
});
