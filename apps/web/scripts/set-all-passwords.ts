// LOCAL TESTING ONLY: give every user the same password so testers can sign in
// as anyone.
//   npm run dev:set-all-passwords                     (uses the default below)
//   npm run dev:set-all-passwords -- --password X
// Also clears lockouts and the "must change password" flag. Each change is
// recorded in the audit log. Refuses to run against a non-local database.
import { parseArgs } from "node:util";
import { recordAudit } from "../src/lib/audit";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/security/password";

const DEFAULT_PASSWORD = "Zonm@1234";

const { values } = parseArgs({ options: { password: { type: "string", default: DEFAULT_PASSWORD }, "allow-remote": { type: "boolean", default: false } } });

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !values["allow-remote"]) {
    throw new Error("Refusing to change passwords on a non-local database (pass --allow-remote for a dev deployment).");
  }
  const password = values.password!;
  if (password.length < 4) throw new Error("Use at least 4 characters.");

  const hash = await hashPassword(password);
  const users = await prisma.user.findMany({ select: { id: true, email: true }, orderBy: { email: "asc" } });
  await prisma.$transaction(
    async (tx) => {
      for (const u of users) {
        await tx.user.update({
          where: { id: u.id },
          data: { passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
        });
        await recordAudit(tx, {
          action: "user.password.reset",
          entityType: "User",
          entityId: u.id,
          userAgent: "cli:set-all-passwords",
          details: { email: u.email, bulk: true, testingOnly: true },
        });
      }
    },
    { timeout: 60_000 },
  );
  console.log(`Set the password of ${users.length} users to: ${password}`);
  for (const u of users) console.log(`  ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
