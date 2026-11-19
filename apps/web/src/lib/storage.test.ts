import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openFile, readEvidence, sealFile, storageRoot, writeEvidence } from "./storage";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "zonm-storage-"));
  process.env.STORAGE_DIR = dir;
  process.env.STORAGE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("evidence storage", () => {
  it("round-trips and stores ciphertext, not plaintext", async () => {
    const plain = Buffer.from("Mon pa konnen kifer zot pe fer sa!!!");
    const rel = await writeEvidence("caseabc12345", "fileabc12345", plain);
    expect(rel).toBe("caseabc12345/fileabc12345.zne");
    const raw = await readFile(path.join(storageRoot(), rel));
    expect(raw.includes(plain)).toBe(false);
    expect(await readEvidence(rel, "fileabc12345")).toEqual(plain);
  });

  it("binds a file to its id", () => {
    const sealed = sealFile(Buffer.from("x"), "fileone12345");
    expect(() => openFile(sealed, "filetwo12345")).toThrow();
  });

  it("detects tampering", () => {
    const sealed = sealFile(Buffer.from("evidence"), "fileone12345");
    sealed[sealed.length - 1] ^= 1;
    expect(() => openFile(sealed, "fileone12345")).toThrow();
  });

  it("never overwrites an existing evidence file", async () => {
    await writeEvidence("caseover1234", "fileover1234", Buffer.from("original"));
    await expect(writeEvidence("caseover1234", "fileover1234", Buffer.from("replacement"))).rejects.toThrow();
    expect((await readEvidence("caseover1234/fileover1234.zne", "fileover1234")).toString()).toBe("original");
  });

  it("rejects path tricks", async () => {
    await expect(writeEvidence("../escape1234", "fileabc12345", Buffer.from("x"))).rejects.toThrow(/Invalid id/);
    await expect(readEvidence("../../etc/passwd", "fileabc12345")).rejects.toThrow(/Invalid storage path/);
  });
});
