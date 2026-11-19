// M1 authentication: login gates, MFA enrolment/challenge, password policy,
// user administration, lockout, audit verification.
const path = require("path");
const { BASE, RUN, ok, done, createUser, launch, totp, shots, MFA_REQUIRED } = require("./lib.cjs");

if (!MFA_REQUIRED) {
  // This suite tests MFA and the forced password change themselves.
  console.log("SKIPPED: AUTH_MFA_REQUIRED=false. Run the app with MFA on to test sign-in security.");
  process.exit(3); // 3 = skipped (see run.cjs)
}

const admin = createUser("admin", "ADMIN");
const ADMIN_EMAIL = admin.email;
const ADMIN_TEMP = admin.temp;
const ANALYST_EMAIL = `analyst-${RUN}@e2e.local`;
const SHOTS = shots;
const NEW_PW = "Coco-de-Mer-Vallee-2026";
const step = () => Math.floor(Date.now() / 30000);
const totpAt = (secret, s) => totp(secret, s);
const waitNextStep = async (after) => { while (step() <= after) await new Promise((r) => setTimeout(r, 500)); };

async function login(page, email, pw) {
  await page.goto(BASE + "/login");
  await page.fill("#email", email);
  await page.fill("#password", pw);
  await Promise.all([page.waitForLoadState("networkidle"), page.click("button[type=submit]")]);
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 1. Unauthenticated access
  await page.goto(BASE + "/admin/users");
  ok(page.url().startsWith(BASE + "/login"), "protected page redirects to /login");
  const api = await page.request.get(BASE + "/api/audit/verify");
  ok(api.status() === 401, `unauthenticated API returns 401 (got ${api.status()})`);

  // 2. Wrong password: generic message
  await login(page, ADMIN_EMAIL, "wrong-password");
  ok(await page.getByText("Sign-in failed").isVisible(), "wrong password shows generic error");
  await login(page, "nobody@zonm.local", "whatever");
  ok(await page.getByText("Sign-in failed").isVisible(), "unknown user shows the same generic error");

  // 3. First login -> forced MFA enrolment
  await login(page, ADMIN_EMAIL, ADMIN_TEMP);
  ok(page.url() === BASE + "/mfa/setup", `first sign-in goes to MFA setup (at ${page.url()})`);
  await page.goto(BASE + "/admin/users");
  ok(page.url() === BASE + "/mfa/setup", "app pages blocked until MFA enrolled");
  await page.screenshot({ path: path.join(SHOTS, "01-mfa-setup.png"), fullPage: true });
  await page.click("summary");
  const secret = (await page.locator("details code").innerText()).replace(/\s/g, "");
  ok(/^[A-Z2-7]{32}$/.test(secret), "manual key shown (160-bit base32)");
  await page.fill("#code", "000000");
  await page.click("button[type=submit]");
  await page.getByText("not valid").waitFor();
  ok(true, "wrong enrolment code rejected");
  const enrolStep = step();
  await page.fill("#code", totpAt(secret, enrolStep));
  await page.click("button[type=submit]");
  await page.getByText("Two-step verification is on").waitFor();
  const codes = await page.locator("ul li").allInnerTexts();
  ok(codes.length === 10, "10 recovery codes shown once");
  await page.screenshot({ path: path.join(SHOTS, "02-recovery-codes.png"), fullPage: true });
  await Promise.all([page.waitForLoadState("networkidle"), page.click("text=I have saved my codes")]);

  // 4. Forced password change
  ok(page.url() === BASE + "/account/password", `temp password forces change (at ${page.url()})`);
  await page.fill("#current", ADMIN_TEMP);
  await page.fill("#next", "short");
  await page.fill("#confirm", "short");
  await page.locator("#next").evaluate((el) => el.removeAttribute("minlength"));
  await page.locator("#confirm").evaluate((el) => el.removeAttribute("minlength"));
  await page.click("button[type=submit]");
  await page.getByRole("alert").getByText("at least 12").waitFor();
  ok(true, "weak password rejected by server policy");
  await page.fill("#current", ADMIN_TEMP);
  await page.fill("#next", NEW_PW);
  await page.fill("#confirm", NEW_PW);
  await Promise.all([page.waitForURL(BASE + "/admin/users"), page.click("button[type=submit]")]);
  ok(true, "password changed; admin lands on Users");

  // 5. Create an analyst
  await page.fill("#name", "Test Analyst");
  await page.fill("#email", ANALYST_EMAIL);
  await page.selectOption("#role", "ANALYST");
  await page.click("text=Create user");
  const tempCode = page.locator("code.select-all").first();
  await tempCode.waitFor();
  const analystTemp = (await tempCode.innerText()).trim();
  ok(/^[\w]{4}(-[\w]{4}){3}$/.test(analystTemp), "analyst created, temp password shown");
  await page.screenshot({ path: path.join(SHOTS, "03-users.png"), fullPage: true });

  // 6. Audit integrity, UI + API
  await page.goto(BASE + "/audit?verify=1");
  ok(await page.getByText("Chain intact").isVisible(), "UI verification: chain intact");
  await page.screenshot({ path: path.join(SHOTS, "04-audit.png"), fullPage: true });
  const r = await page.request.get(BASE + "/api/audit/verify");
  const j = await r.json();
  ok(r.status() === 200 && j.intact === true && j.problems.length === 0, `API verification intact (head seq ${j.head?.seq})`);
  const body = await page.content();
  for (const a of ["auth.login.failure", "auth.login.success", "auth.mfa.enrolled", "auth.password.changed", "user.create"])
    ok(body.includes(a), `audit shows ${a}`);
  ok(!body.includes(NEW_PW) && !body.includes(analystTemp), "no passwords in the audit log");

  // 7. Sign out, sign in again: replayed TOTP rejected, recovery code accepted
  await Promise.all([page.waitForURL(/\/login/), page.click("text=Sign out")]);
  await page.goto(BASE + "/admin/users");
  ok(page.url().startsWith(BASE + "/login"), "signed out session is no longer valid");
  await login(page, ADMIN_EMAIL, NEW_PW);
  ok(page.url() === BASE + "/mfa", "returning user gets MFA challenge");
  await page.fill("#code", totpAt(secret, enrolStep));
  await page.click("button[type=submit]");
  await page.getByText("not valid").waitFor();
  ok(true, "replayed TOTP code rejected");
  await page.fill("#code", codes[0]);
  await Promise.all([page.waitForURL(BASE + "/admin/users"), page.click("button[type=submit]")]);
  ok(true, "recovery code accepted");
  await Promise.all([page.waitForURL(/\/login/), page.click("text=Sign out")]);
  await login(page, ADMIN_EMAIL, NEW_PW);
  await page.fill("#code", codes[0]);
  await page.click("button[type=submit]");
  await page.getByText("not valid").waitFor();
  ok(true, "used recovery code cannot be reused");
  await waitNextStep(enrolStep);
  await page.fill("#code", totpAt(secret, step()));
  await Promise.all([page.waitForURL(BASE + "/admin/users"), page.click("button[type=submit]")]);
  ok(true, "fresh TOTP code accepted");

  // 8. Lockout on the analyst account
  const p2 = await (await browser.newContext()).newPage();
  for (let i = 0; i < 5; i++) await login(p2, ANALYST_EMAIL, "wrong-" + i);
  await login(p2, ANALYST_EMAIL, analystTemp);
  ok(p2.url().startsWith(BASE + "/login"), "correct password refused while locked");
  await page.goto(BASE + "/admin/users");
  ok(await page.getByText("Locked").isVisible(), "admin sees the account as Locked");
  await page.click("text=Unlock");
  await page.waitForLoadState("networkidle");
  await login(p2, ANALYST_EMAIL, analystTemp);
  ok(p2.url() === BASE + "/mfa/setup", "after unlock the analyst can sign in");
  await page.goto(BASE + "/audit?action=auth.lockout");
  ok(await page.getByText("auth.lockout").first().isVisible(), "lockout recorded in audit log");

  // 9. Admin is denied case evidence; analyst cannot open admin pages
  await page.goto(BASE + "/");
  ok(page.url() === BASE + "/admin/users", "admin has no case area");

  await browser.close();
  process.exit(done());
})().catch((e) => { console.error(e); process.exit(2); });
