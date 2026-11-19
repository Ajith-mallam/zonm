// M3 candidates: pseudonyms, handles, restricted identity (reveal with purpose,
// audited), role restrictions, deletion guard. Section 8 needs `npm run db:seed-demo`.
const path = require("path");
const { BASE, RUN, ok, done, createUser, launch, onboard, settle, submit, alertText, shots } = require("./lib.cjs");

const REAL_NAME = `Marcel Testperson ${RUN}`;

(async () => {
  const browser = await launch();
  const u = {
    sup: createUser("sup", "SUPERVISOR"),
    lead: createUser("lead", "ANALYST"),
    analyst: createUser("analyst", "ANALYST"),
    observer: createUser("observer", "AUDITOR"),
  };
  const p = {};
  for (const [k, user] of Object.entries(u)) p[k] = await onboard(browser, user);

  // Setup: supervisor creates a case led by `lead`; lead adds analyst + observer.
  await p.sup.goto(BASE + "/cases/new");
  await p.sup.fill("#title", `Candidate test ${RUN}`);
  await p.sup.selectOption("#leadId", { label: `${u.lead.name} (analyst)` });
  await Promise.all([p.sup.waitForURL(/\/cases\/c[a-z0-9]+$/), p.sup.click("text=Create case")]);
  const caseId = p.sup.url().split("/").pop();
  const C = (tab = "") => `${BASE}/cases/${caseId}${tab}`;
  for (const [k, role] of [["analyst", "ANALYST"], ["observer", "OBSERVER"]]) {
    await p.lead.goto(C("/team"));
    const form = p.lead.locator("form", { has: p.lead.locator("#userId") });
    await form.locator("#userId").selectOption(await form.locator("#userId option", { hasText: u[k].name }).getAttribute("value"));
    await form.locator("#role").selectOption(role);
    await submit(p.lead, form, "Add to team");
  }

  // 1. Add a candidate with the suggested pseudonym
  await p.lead.goto(C("/candidates"));
  ok((await p.lead.inputValue("#pseudonym")) === "Candidate A", "first pseudonym suggested as Candidate A");
  await Promise.all([p.lead.waitForURL(/candidates\/c[a-z0-9]+$/), p.lead.click("text=Add candidate >> nth=-1")]);
  const candA = p.lead.url();
  ok(await p.lead.getByText("No known writing yet.").isVisible(), "new candidate shows no known writing");
  await p.lead.goto(C("/candidates"));
  ok((await p.lead.inputValue("#pseudonym")) === "Candidate B", "next pseudonym suggested as Candidate B");
  await p.lead.fill("#pseudonym", "candidate a");
  await submit(p.lead, p.lead.locator("form", { has: p.lead.locator("#pseudonym") }), "Add candidate");
  ok(/already used/.test(await alertText(p.lead)), "duplicate pseudonym (any case) refused");

  // 2. Handles
  await p.lead.goto(candA);
  const hf = () => p.lead.locator("form", { has: p.lead.locator("#handle") });
  await hf().locator("#platform").selectOption("INSTAGRAM");
  await hf().locator("#handle").fill("  @sey.voice ");
  await hf().locator("#profileUrl").fill("https://www.instagram.com/sey.voice");
  await submit(p.lead, hf(), "Add");
  ok((await p.lead.locator("td.font-mono", { hasText: "sey.voice" }).count()) === 1 && !(await p.lead.content()).includes("@sey.voice"), "handle stored normalised (no @)");
  await hf().locator("#platform").selectOption("INSTAGRAM");
  await hf().locator("#handle").fill("sey.voice");
  await submit(p.lead, hf(), "Add");
  ok(/already recorded/.test(await alertText(hf())), "duplicate handle refused");
  await hf().locator("#platform").selectOption("FACEBOOK");
  await hf().locator("#handle").fill("sey.voice.fb");
  await hf().locator("#profileUrl").fill("ftp://example.sc/x");
  await submit(p.lead, hf(), "Add");
  ok(/http/.test(await alertText(hf())), "non-http profile URL refused by the server");

  // 3. Identity: analyst lead cannot record one; supervisor can
  ok(await p.lead.getByText("No identity has been recorded").isVisible(), "analyst lead sees no identity and no form to create one");
  await p.sup.goto(candA);
  await p.sup.fill("#realName", REAL_NAME);
  await p.sup.fill("#dateOfBirth", "1990-02-03");
  await p.sup.fill("#legalReference", `W/${RUN}`);
  await p.sup.fill("#identifiers", "NIN 999-0000-111 (test)");
  await p.sup.locator("#legalBasis").evaluate((el) => el.removeAttribute("minlength"));
  await p.sup.fill("#legalBasis", "no");
  await submit(p.sup, p.sup.locator("form", { has: p.sup.locator("#realName") }), "Save identity");
  ok(/legal basis/i.test(await alertText(p.sup)), "identity without a proper legal basis refused");
  ok(
    (await p.sup.inputValue("#realName")) === REAL_NAME && (await p.sup.inputValue("#dateOfBirth")) === "1990-02-03" && (await p.sup.inputValue("#identifiers")).includes("999-0000-111"),
    "typed values are kept after a validation error",
  );
  await p.sup.fill("#legalBasis", "Cybercrimes Act s.12 production order (test)");
  await submit(p.sup, p.sup.locator("form", { has: p.sup.locator("#realName") }), "Save identity");
  await p.sup.goto(candA);
  ok(!(await p.sup.content()).includes(REAL_NAME), "after saving, the name is not in the page until revealed");
  ok(await p.sup.getByText("An identity is on file").isVisible(), "reveal form shown");

  // 4. Reveal requires a purpose and is audited
  await p.sup.locator("#purpose").evaluate((el) => el.removeAttribute("minlength"));
  await p.sup.fill("#purpose", "x");
  await submit(p.sup, p.sup.locator("form", { has: p.sup.locator("#purpose") }), "Reveal identity");
  ok(/why you need/.test(await alertText(p.sup)), "reveal without a purpose refused");
  await p.sup.fill("#purpose", "Checking the warrant reference");
  await submit(p.sup, p.sup.locator("form", { has: p.sup.locator("#purpose") }), "Reveal identity");
  ok((await p.sup.getByTestId("real-name").innerText()) === REAL_NAME, "supervisor reveals the identity");
  const shown = await p.sup.locator("dl").innerText();
  ok(shown.includes("1990-02-03") && shown.includes("999-0000-111") && shown.includes(`W/${RUN}`), "every identity field was saved and is shown");
  ok(await p.sup.getByRole("button", { name: "Edit identity" }).isVisible(), "supervisor may edit after revealing");
  await p.sup.screenshot({ path: path.join(shots, "m3-01-candidate.png"), fullPage: true });

  await p.lead.goto(candA);
  await p.lead.fill("#purpose", "Preparing interview plan");
  await submit(p.lead, p.lead.locator("form", { has: p.lead.locator("#purpose") }), "Reveal identity");
  ok((await p.lead.getByTestId("real-name").innerText()) === REAL_NAME, "analyst lead can reveal (identity.read)");
  ok((await p.lead.getByRole("button", { name: "Edit identity" }).count()) === 0, "analyst lead cannot edit the identity");

  // 5. Observer is fully restricted
  await p.observer.goto(C("/candidates"));
  ok(!(await p.observer.content()).includes("Identity on file") && (await p.observer.locator("#pseudonym").count()) === 0, "observer: no identity flag, no add form");
  await p.observer.goto(candA);
  ok(await p.observer.getByText("Your role on this case does not include access").isVisible(), "observer: identity restricted");
  ok((await p.observer.locator("#handle").count()) === 0, "observer cannot add handles");

  // 6. Analyst member adds and deletes a candidate
  await p.analyst.goto(C("/candidates"));
  ok(await p.analyst.getByText("Identity on file").isVisible(), "analyst member sees the identity-on-file flag");
  await Promise.all([p.analyst.waitForURL(/candidates\/c[a-z0-9]+$/), p.analyst.click("text=Add candidate >> nth=-1")]);
  await submit(p.analyst, p.analyst.locator("form", { hasText: "Delete Candidate B" }), "Delete Candidate B");
  await p.analyst.waitForURL(/\/candidates$/);
  ok(!(await p.analyst.locator("table").innerText()).includes("Candidate B"), "candidate without evidence deleted");

  // 7. Audit: reads recorded with purpose, no identity values anywhere in the log
  await p.observer.goto(BASE + "/audit?action=candidate.identity");
  const audit = await p.observer.content();
  ok(audit.includes("candidate.identity.read") && audit.includes("Checking the warrant reference") && audit.includes("Preparing interview plan"), "identity reads audited with their purpose");
  ok(audit.includes("candidate.identity.create"), "identity creation audited");
  ok(!audit.includes(REAL_NAME) && !audit.includes("999-0000-111") && !audit.includes("1990-02-03"), "no identity values in the audit log");
  await p.lead.goto(C("/activity"));
  ok((await p.lead.content()).includes("Identity viewed"), "case activity shows identity views");

  // 8. Demo data: sufficiency levels and deletion guard
  await p.sup.goto(BASE + "/?q=Beau+Vallon");
  await Promise.all([p.sup.waitForURL(/\/cases\/c/), p.sup.locator("table a", { hasText: "Beau Vallon" }).click()]);
  await p.sup.click("text=Candidates");
  await settle(p.sup);
  const rows = await p.sup.locator("tbody tr").allInnerTexts();
  const level = (name) => rows.find((r) => r.startsWith(name)) ?? "";
  ok(/Good/.test(level("Candidate A")) && /Limited/.test(level("Candidate B")) && /Insufficient/.test(level("Candidate C")), "demo case: A good, B limited, C insufficient");
  await p.sup.screenshot({ path: path.join(shots, "m3-02-demo-candidates.png"), fullPage: true });
  await Promise.all([p.sup.waitForURL(/candidates\/c[a-z0-9]+$/), p.sup.locator("tbody a", { hasText: "Candidate A" }).click()]);
  const guard = p.sup.getByText(/document\(s\) attached and cannot be deleted/);
  ok(await guard.waitFor({ timeout: 10000 }).then(() => true, () => false), "candidate with evidence cannot be deleted");
  ok((await p.sup.content()).includes("Enough known writing"), "candidate page shows the sufficiency detail");

  const v = await (await p.observer.request.get(BASE + "/api/audit/verify")).json();
  ok(v.intact === true, `audit chain intact (head ${v.head?.seq})`);
  await browser.close();
  process.exit(done());
})().catch((e) => { console.error(e); process.exit(2); });
