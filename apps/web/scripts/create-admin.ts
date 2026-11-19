// Bootstrap the first administrator (or any user) from the command line.
//   npm run user:create -- --email admin@example.sc --name "Jane Doe" [--role ADMIN]
// Prints a one-time temporary password. The user must change it and enrol in
// MFA at first sign-in. The creation is recorded in the audit log with no actor.
import { Role } from "@prisma/client";
import { parseArgs } from "node:util";
import { prisma } from "../src/lib/db";
import { createUser, UserInputError } from "../src/lib/users";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "ADMIN" } },
});

async function main() {
  if (!values.email || !values.name) {
    console.error('Usage: npm run user:create -- --email <email> --name "<full name>" [--role ADMIN|SUPERVISOR|ANALYST|REVIEWER|AUDITOR]');
    process.exit(2);
  }
  const role = values.role as Role;
  if (!Object.values(Role).includes(role)) throw new UserInputError(`Unknown role ${values.role}`);
  const { user, temporaryPassword } = await prisma.$transaction((tx) =>
    createUser(tx, { email: values.email!, name: values.name!, role }, null, { userAgent: "cli:create-admin" }),
  );
  console.log(`Created ${user.role} ${user.email}`);
  console.log(`Temporary password (shown once): ${temporaryPassword}`);
}

main()
  .catch((e) => {
    console.error(e instanceof UserInputError ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
