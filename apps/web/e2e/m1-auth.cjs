// M1 authentication: sign-in gates, password policy, user administration,
// lockout and audit verification. Adapts to the server's switches: the MFA
// steps run when AUTH_MFA_REQUIRED is on; with it off the suite checks that
// no MFA step or MFA control appears. The forced password change runs when
// AUTH_FORCE_PASSWORD_CHANGE is on.
const path = require("path");
const { BASE, RUN, ok, done, createUser, launch, totp, shots, MFA_REQUIRED } = require("./lib.cjs");

const FORCE_CHANGE = process.env.AUTH_FORCE_PASSWORD_CHANGE !== "false";
const admin = createUser("admin", "ADMIN");
const ANALYST_EMAIL = `analyst-${RUN}@e2e.local`;
const NEW_PW = "Coco-de-Mer-Vallee-2026";
const step = () => Math.floor(Date.now() / 30000);
const waitNextStep = async (after) => { while (step() <= after) await new Promise((r) => setTimeout(r, 500)); };
const path_ = (page) => new URL(page.url()).pathname;

async function login(page, email, pw) {
  await page.goto(BASE + "/login");
  await page.fill("#email", email);
  await page.fill("#password", pw);
  await Promise.all([page.waitForLoadState("networkidle"), page.click("button[type=submit]")]);
  await page.waitForLoadState("networkidle"); // let gate redirects settle
}

(async () => {
  console.log(`(server switches: MFA ${MFA_REQUIRED ? "on" : "off"}, forced password change ${FORCE_CHANGE ? "on" : "off"})`);
  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  let password = admin.temp;
  let secret, enrolStep, codes;

  // 1. Unauthenticated access
  await page.goto(BASE + "/admin/users");
  ok(page.url().startsWith(BASE + "/login"), "protected page redirects to /login");
  const api = await page.request.get(BASE + "/api/audit/verify");
  ok(api.status() === 401, `unauthenticated API returns 401 (got ${api.status()})`);

  // 2. Wrong password: generic message
  await login(page, admin.email, "wrong-password");
  ok(await page.getByText("Sign-in failed").isVisible(), "wrong password shows generic error");
  await login(page, "nobody@zonm.local", "whatever");
  ok(await page.getByText("Sign-in failed").isVisible(), "unknown user shows the same generic error");

  // 3. First sign-in
  await login(page, admin.email, admin.temp);
  if (MFA_REQUIRED) {
    ok(path_(page) === "/mfa/setup", `first sign-in goes to MFA setup (at ${path_(page)})`);
    await page.goto(BASE + "/admin/users");
    ok(path_(page) === "/mfa/setup", "app pages blocked until MFA enrolled");
    await page.click("summary");
    secret = (await page.locator("details code").innerText()).replace(/\s/g, "");
    ok(/^[A-Z2-7]{32}$/.test(secret), "manual key shown (160-bit base32)");
    await page.fill("#code", "000000");
    await page.click("button[type=submit]");
    await page.getByText("not valid").waitFor();
    ok(true, "wrong enrolment code rejected");
    enrolStep = step();
    await page.fill("#code", totp(secret, enrolStep));
    await page.click("button[type=submit]");
    await page.getByText("Two-step verification is on").waitFor();
    codes = await page.locator("ul li").allInnerTexts();
    ok(codes.length === 10, "10 recovery codes shown once");
    await Promise.all([page.waitForLoadState("networkidle"), page.click("text=I have saved my codes")]);
    await page.waitForLoadState("networkidle");
  } else {
    ok(!["/mfa", "/mfa/setup"].includes(path_(page)), `no MFA step at sign-in (at ${path_(page)})`);
    await page.goto(BASE + "/mfa/setup");
    await page.waitForLoadState("networkidle");
    ok(!path_(page).startsWith("/mfa"), "MFA pages redirect into the app when MFA is off");
  }

  // 4. Forced password change (temporary password)
  if (FORCE_CHANGE) {
    if (path_(page) !== "/account/password") {
      await page.goto(BASE + "/admin/users"); // any app page sends the user to the password change
      await page.waitForLoadState("networkidle");
    }
    ok(path_(page) === "/account/password", `temporary password forces a change (at ${path_(page)})`);
    await page.fill("#current", admin.temp);
    await page.fill("#next", "short");
    await page.fill("#confirm", "short");
    await page.locator("#next").evaluate((el) => el.removeAttribute("minlength"));
    await page.locator("#confirm").evaluate((el) => el.removeAttribute("minlength"));
    await page.click("button[type=submit]");
    await page.getByRole("alert").getByText("at least 12").waitFor();
    ok(true, "weak password rejected by server policy");
    await page.fill("#current", admin.temp);
    await page.fill("#next", NEW_PW);
    await page.fill("#confirm", NEW_PW);
    await Promise.all([page.waitForURL(BASE + "/admin/users"), page.click("button[type=submit]")]);
    ok(true, "password changed; admin lands on Users");
    password = NEW_PW;
  } else {
    await page.goto(BASE + "/admin/users");
    ok(path_(page) === "/admin/users", "no forced password change (switch off): admin reaches Users");
  }

  // 5. Create an analyst; the Users page matches the switches
  await page.fill("#name", "Test Analyst");
  await page.fill("#email", ANALYST_EMAIL);
  await page.selectOption("#role", "ANALYST");
  await page.click("text=Create user");
  const tempCode = page.locator("code.select-all").first();
  await tempCode.waitFor();
  const analystTemp = (await tempCode.innerText()).trim();
  ok(/^[\w]{4}(-[\w]{4}){3}$/.test(analystTemp), "analyst created, temp password shown");
  const users = await page.locator("main").innerText();
  if (MFA_REQUIRED) {
    ok(/No MFA/.test(users) && /two-step verification/.test(users), "Users page shows MFA status and the first-sign-in MFA step");
  } else {
    ok(!/No MFA|Reset MFA|two-step verification/.test(users), "no MFA badge, button or message on the Users page");
  }
  await page.screenshot({ path: path.join(shots, "m1-users.png"), fullPage: true });

  // 6. Audit integrity, UI + API
  await page.goto(BASE + "/audit?verify=1");
  ok(await page.getByText("Chain intact").isVisible(), "UI verification: chain intact");
  const r = await page.request.get(BASE + "/api/audit/verify");
  const j = await r.json();
  ok(r.status() === 200 && j.intact === true && j.problems.length === 0, `API verification intact (head seq ${j.head?.seq})`);
  const body = await page.content();
  const expected = ["auth.login.failure", "auth.login.success", "user.create", ...(MFA_REQUIRED ? ["auth.mfa.enrolled"] : []), ...(FORCE_CHANGE ? ["auth.password.changed"] : [])];
  for (const a of expected) ok(body.includes(a), `audit shows ${a}`);
  ok(!body.includes(NEW_PW) && !body.includes(analystTemp) && !body.includes(admin.temp), "no passwords in the audit log");

  // 7. Sign out; sign in again
  await Promise.all([page.waitForURL(/\/login/), page.click("text=Sign out")]);
  await page.goto(BASE + "/admin/users");
  ok(page.url().startsWith(BASE + "/login"), "signed-out session is no longer valid");
  await login(page, admin.email, password);
  if (MFA_REQUIRED) {
    ok(path_(page) === "/mfa", "returning user gets MFA challenge");
    await page.fill("#code", totp(secret, enrolStep));
    await page.click("button[type=submit]");
    await page.getByText("not valid").waitFor();
    ok(true, "replayed TOTP code rejected");
    await page.fill("#code", codes[0]);
    await Promise.all([page.waitForURL(BASE + "/admin/users"), page.click("button[type=submit]")]);
    ok(true, "recovery code accepted");
    await Promise.all([page.waitForURL(/\/login/), page.click("text=Sign out")]);
    await login(page, admin.email, password);
    await page.fill("#code", codes[0]);
    await page.click("button[type=submit]");
    await page.getByText("not valid").waitFor();
    ok(true, "used recovery code cannot be reused");
    await waitNextStep(enrolStep);
    await page.fill("#code", totp(secret, step()));
    await Promise.all([page.waitForURL(BASE + "/admin/users"), page.click("button[type=submit]")]);
    ok(true, "fresh TOTP code accepted");
  } else {
    ok(path_(page) === "/admin/users", "returning user signs in with the password alone");
  }

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
  ok(!p2.url().startsWith(BASE + "/login"), `after unlock the analyst can sign in (at ${path_(p2)})`);
  await page.goto(BASE + "/audit?action=auth.lockout");
  ok(await page.getByText("auth.lockout").first().isVisible(), "lockout recorded in audit log");

  // 9. Admin is denied case evidence
  await page.goto(BASE + "/");
  ok(path_(page) === "/admin/users", "admin has no case area");

  await browser.close();
  process.exit(done());
})().catch((e) => { console.error(e); process.exit(2); });
