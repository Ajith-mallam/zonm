// Local PostgreSQL 16 for development, for machines where the native install
// (infra/setup-windows.ps1, needs Administrator) has not been run.
//   cd infra/devdb && npm install && npm start
// Data lives in infra/devdb/data (git-ignored). Stop with Ctrl+C.
// Connection: postgresql://zonm:zonm_dev_password@localhost:5432/zonm
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.join(import.meta.dirname, "data");
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "zonm",
  password: "zonm_dev_password",
  port: Number(process.env.PGPORT ?? 5432),
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("zonm");
console.log("PostgreSQL 16 ready: postgresql://zonm:zonm_dev_password@localhost:5432/zonm");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
