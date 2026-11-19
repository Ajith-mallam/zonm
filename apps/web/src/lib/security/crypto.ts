// AES-256-GCM for secrets stored in the database (TOTP secrets). Format:
// "v1.<iv>.<tag>.<ciphertext>", each base64url. The key comes from
// MFA_ENCRYPTION_KEY (32 bytes, base64). The version prefix allows key rotation.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function loadKey(raw = process.env.MFA_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("MFA_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plaintext: string, aad: string, key: Buffer = loadKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/**
 * ``aad`` binds the ciphertext to its owner (the user id), so a secret copied
 * to another user's row fails to decrypt.
 */
export function decryptSecret(sealed: string, aad: string, key: Buffer = loadKey()): string {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
