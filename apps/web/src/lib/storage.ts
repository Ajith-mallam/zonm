// Evidence file store. Original uploads are kept byte-for-byte, encrypted at
// rest with AES-256-GCM (STORAGE_ENCRYPTION_KEY) and bound to their SourceFile
// id, so a file swapped between records fails to decrypt. Files are written
// once and never overwritten.
//   Layout: <STORAGE_DIR>/<caseId>/<sourceFileId>.zne
//   Format: "ZNE1" | iv (12) | tag (16) | ciphertext
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MAGIC = Buffer.from("ZNE1");
const ID = /^[a-z0-9]{8,40}$/;

export function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"));
}

function key(raw = process.env.STORAGE_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("STORAGE_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("STORAGE_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function sealFile(plain: Uint8Array, fileId: string, k: Buffer = key()): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(Buffer.from(fileId));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

export function openFile(sealed: Uint8Array, fileId: string, k: Buffer = key()): Buffer {
  const b = Buffer.from(sealed);
  if (!b.subarray(0, 4).equals(MAGIC)) throw new Error("Not a ZONM evidence file");
  const d = createDecipheriv("aes-256-gcm", k, b.subarray(4, 16));
  d.setAAD(Buffer.from(fileId));
  d.setAuthTag(b.subarray(16, 32));
  return Buffer.concat([d.update(b.subarray(32)), d.final()]);
}

function resolve(storagePath: string): string {
  const root = storageRoot();
  const full = path.resolve(root, storagePath);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage path");
  return full;
}

/** Store a new evidence file. Returns the relative storage path. */
export async function writeEvidence(caseId: string, fileId: string, bytes: Uint8Array): Promise<string> {
  if (!ID.test(caseId) || !ID.test(fileId)) throw new Error("Invalid id");
  const rel = `${caseId}/${fileId}.zne`;
  const full = resolve(rel);
  await mkdir(path.dirname(full), { recursive: true });
  // Write to a temporary name, then hard-link into place: link() fails if the
  // target exists (rename() would silently replace it), so an evidence file can
  // never be overwritten, and readers never see a half-written file.
  const tmp = `${full}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, sealFile(bytes, fileId), { flag: "wx" });
  try {
    await link(tmp, full);
  } finally {
    await unlink(tmp);
  }
  return rel;
}

export async function readEvidence(storagePath: string, fileId: string): Promise<Buffer> {
  return openFile(await readFile(resolve(storagePath)), fileId);
}
