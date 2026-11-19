// Runs the end-to-end suites in order against a running app.
//   npm run test:e2e              (all suites)
//   npm run test:e2e -- m3        (suites whose file name contains "m3")
// Needs: the app running at E2E_BASE_URL (default http://localhost:3100), the
// dev database, and a Playwright Chromium headless shell (PLAYWRIGHT_BROWSERS_PATH
// or `npx playwright-core install chromium-headless-shell`). The M3 suite also
// expects the demo data (`npm run db:seed-demo`). Screenshots go to e2e/.artifacts.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const filter = process.argv[2] ?? "";
const suites = fs.readdirSync(__dirname).filter((f) => /^m\d+-.*\.cjs$/.test(f) && f.includes(filter)).sort();
const results = [];
for (const s of suites) {
  console.log(`\n=== ${s}`);
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: "inherit", env: process.env });
  results.push([s, r.status === 0, ((Date.now() - t) / 1000).toFixed(0)]);
}
console.log("\n=== Summary");
for (const [s, pass, secs] of results) console.log(`${pass ? "PASS" : "FAIL"}  ${s}  (${secs}s)`);
process.exit(results.every(([, pass]) => pass) ? 0 : 1);
