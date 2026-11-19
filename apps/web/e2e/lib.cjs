// Shared helpers for the ZONM NET end-to-end checks.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const crypto = require("crypto");

const path = require("path");
const fs = require("fs");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const WEB = path.resolve(__dirname, "..");
const shots = path.join(__dirname, ".artifacts");
fs.mkdirSync(shots, { recursive: true });
const PW = "Anse-Lazio-Granite-2026";
const RUN = Date.now().toString(36);

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const done = () => { console.log(fails ? `${fails} FAILED` : "ALL PASSED"); return fails ? 1 : 0; };

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32d = (s) => { let bits = 0, v = 0; const out = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, step = Math.floor(Date.now() / 30000)) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac("sha1", b32d(secret)).update(m).digest(); const o = h[h.length - 1] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0"); };

function createUser(tag, role) {
  const email = `${tag}-${RUN}@e2e.local`;
  const name = `E2E ${tag} ${RUN}`;
  const out = execSync(`npm run user:create -- --email ${email} --name "${name}" --role ${role}`, { cwd: WEB, encoding: "utf8" });
  return { email, name, role, temp: out.match(/shown once\): (\S+)/)[1] };
}

// Uses Playwright's installed headless shell (PLAYWRIGHT_BROWSERS_PATH), or E2E_CHROMIUM_PATH.
const launch = () => chromium.launch(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {});

/** The server's switches, as set in apps/web/.env (loaded by run.cjs). */
const MFA_REQUIRED = process.env.AUTH_MFA_REQUIRED !== "false";

/**
 * First sign-in. Completes whichever gates the server enforces: MFA enrolment
 * (when AUTH_MFA_REQUIRED is on) and the forced password change (when
 * AUTH_FORCE_PASSWORD_CHANGE is on). Returns a signed-in page.
 */
async function onboard(browser, u) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + "/login");
  await page.fill("#email", u.email);
  await page.fill("#password", u.temp);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  if (new URL(page.url()).pathname === "/mfa/setup") {
    await page.click("summary");
    u.secret = (await page.locator("details code").innerText()).replace(/\s/g, "");
    await page.fill("#code", totp(u.secret));
    await page.click("button[type=submit]");
    await Promise.all([page.waitForURL((url) => url.pathname !== "/mfa/setup"), page.click("text=I have saved my codes")]);
  }
  if (new URL(page.url()).pathname === "/account/password") {
    await page.fill("#current", u.temp);
    await page.fill("#next", PW);
    await page.fill("#confirm", PW);
    await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/account")), page.click("button[type=submit]")]);
  }
  return page;
}

const settle = (page) => page.waitForLoadState("networkidle");
/** Click a named button inside a form and wait for the round trip. */
async function submit(page, form, name) {
  // Wait for the server action's own POST, not just network idle (which can
  // resolve before the request starts).
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 15000 }).catch(() => null),
    form.getByRole("button", { name }).click(),
  ]);
  await settle(page);
}
// Form errors render with role="alert"; skip the route announcer Next.js adds to every page.
const alertText = async (scope) => {
  const a = scope.locator('[role="alert"]:not(#__next-route-announcer__)');
  return (await a.count()) ? (await a.first().innerText()).trim() : "";
};

module.exports = { MFA_REQUIRED, shots, BASE, PW, RUN, ok, done, totp, createUser, launch, onboard, settle, submit, alertText };
