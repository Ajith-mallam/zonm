// M1 user administration. Shared by the admin UI and scripts/create-admin.ts.
import type { Role } from "@prisma/client";
import { randomInt } from "node:crypto";
import { recordAudit } from "./audit";
import type { Db } from "./db";
import { checkPasswordPolicy, hashPassword } from "./security/password";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no 0/O, 1/l/I

/** A one-time password the user must change at first sign-in, e.g. "Hk7p-x2Qa-9mRt-Wc4e". */
export function generateTemporaryPassword(): string {
  for (;;) {
    const pw = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && checkPasswordPolicy(pw).ok) return pw;
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createUser(
  db: Db,
  input: { email: string; name: string; role: Role },
  actor: { id: string; email: string } | null,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new UserInputError("Enter a valid e-mail address.");
  const name = input.name.trim();
  if (name.length < 2) throw new UserInputError("Enter the user's full name.");
  if (await db.user.findUnique({ where: { email } })) throw new UserInputError("A user with that e-mail already exists.");

  const temporaryPassword = generateTemporaryPassword();
  const user = await db.user.create({
    data: { email, name, role: input.role, passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
  });
  await recordAudit(db, {
    action: "user.create",
    actor,
    entityType: "User",
    entityId: user.id,
    ...ctx,
    details: { email, name, role: input.role },
  });
  return { user, temporaryPassword };
}

export class UserInputError extends Error {}
