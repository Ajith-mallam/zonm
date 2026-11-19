// M2 case management: visibility, team, status workflow, closed/archived
// rules, member removal, audit content.
const path = require("path");
const { BASE, RUN, ok, done, createUser, launch, onboard, settle, submit, shots } = require("./lib.cjs");

const TITLE = `Threatening posts ${RUN} (secret title)`;
let browser;
const caseUrl = (id, tab = "") => `${BASE}/cases/${id}${tab}`;
async function status(page, id, toLabel, reason) {
  await page.goto(caseUrl(id));
  const form = page.locator("form", { has: page.locator("#to") });
  const opt = form.locator("#to option", { hasText: toLabel });
  if ((await opt.count()) === 0) return "unavailable";
  await form.locator("#to").selectOption(await opt.first().getAttribute("value"));
  await form.locator("#reason").fill(reason ?? "");
  await submit(page, form, "Update status");
  const err = form.getByRole("alert");
  return (await err.count()) ? await err.innerText() : "ok";
}
const badge = async (page) => (await page.locator("h1").locator("xpath=../..").innerText());

(async () => {
  browser = await launch();
  const users = {
    sup: createUser("sup", "SUPERVISOR"),
    lead: createUser("lead", "ANALYST"),
    analyst: createUser("analyst", "ANALYST"),
    outsider: createUser("outsider", "ANALYST"),
    reviewer: createUser("reviewer", "REVIEWER"),
    auditor: createUser("auditor", "AUDITOR"),
  };
  const p = {};
  for (const [k, u] of Object.entries(users)) p[k] = await onboard(browser, u);
  ok(true, "6 users onboarded through MFA enrolment and password change");

  // 1. Supervisor creates a case with an analyst lead
  await p.sup.goto(BASE + "/cases/new");
  await p.sup.fill("#title", TITLE);
  await p.sup.fill("#description", "Posts on a public page; questioned author unknown.");
  await p.sup.selectOption("#priority", "HIGH");
  await p.sup.selectOption("#leadId", { label: `${users.lead.name} (analyst)` });
  await Promise.all([p.sup.waitForURL(/\/cases\/c[a-z0-9]+$/), p.sup.click("text=Create case")]);
  const id = p.sup.url().split("/").pop();
  const header = await badge(p.sup);
  const ref = header.match(/ZN-\d{4}-\d{4,}/)?.[0];
  ok(!!ref, `case created with reference ${ref}`);
  ok(header.includes("Open") && header.includes("High priority") && header.includes(users.lead.name), "header shows status, priority and lead");
  await p.sup.screenshot({ path: path.join(shots, "m2-01-overview.png"), fullPage: true });

  // 2. Non-members cannot see the case
  await p.outsider.goto(BASE + "/");
  ok(!(await p.outsider.content()).includes(ref), "outsider's case list does not show the case");
  const r404 = await p.outsider.goto(caseUrl(id));
  ok(r404.status() === 404, `outsider gets 404 on the case URL (got ${r404.status()})`);
  await p.lead.goto(BASE + "/");
  ok((await p.lead.content()).includes(ref), "lead sees the case in their list");

  // 3. Lead builds the team
  for (const [k, role] of [["analyst", "ANALYST"], ["reviewer", "REVIEWER"], ["auditor", "OBSERVER"]]) {
    await p.lead.goto(caseUrl(id, "/team"));
    const form = p.lead.locator("form", { has: p.lead.locator("#userId") });
    const v = await form.locator("#userId option", { hasText: users[k].name }).getAttribute("value");
    await form.locator("#userId").selectOption(v);
    await form.locator("#role").selectOption(role);
    await submit(p.lead, form, "Add to team");
  }
  const team = await p.lead.locator("table").innerText();
  ok(["analyst", "reviewer", "auditor"].every((k) => team.includes(users[k].name)), "lead added analyst, reviewer and observer");
  await p.lead.screenshot({ path: path.join(shots, "m2-02-team.png"), fullPage: true });

  // 4. Analyst works the case
  await p.analyst.goto(caseUrl(id, "/team"));
  ok((await p.analyst.locator("text=Add member").count()) === 0, "ordinary analyst cannot manage the team");
  await p.analyst.goto(caseUrl(id, "/notes"));
  await p.analyst.fill("#body", "Collected 14 posts from the page. Two candidate authors identified.");
  await submit(p.analyst, p.analyst.locator("form", { has: p.analyst.locator("#body") }), "Add note");
  ok((await p.analyst.content()).includes("Collected 14 posts"), "analyst added a note");
  await p.analyst.goto(caseUrl(id, "/tasks"));
  const tf = p.analyst.locator("form", { has: p.analyst.locator("#dueAt") });
  await tf.locator("#title").fill("Request known writing samples");
  await tf.locator("#assigneeId").selectOption({ label: users.analyst.name });
  await tf.locator("#dueAt").fill("2026-01-05");
  await submit(p.analyst, tf, "Add task");
  ok(await p.analyst.getByText("Request known writing samples").isVisible(), "analyst added a task");
  ok((await p.analyst.locator("td .bg-red-100").count()) >= 1, "past-due task flagged as overdue");
  ok((await status(p.analyst, id, "Start analysis")) === "ok", "analyst starts analysis");
  ok((await status(p.analyst, id, "Close")) === "unavailable", "analyst is not offered Close");
  ok((await status(p.analyst, id, "Send for review")) === "ok", "analyst sends for review");

  // 5. Reviewer returns it; a reason is mandatory
  const noReason = await status(p.reviewer, id, "Return to analysis", "");
  ok(/reason/i.test(noReason), `returning without a reason is refused ("${noReason.trim()}")`);
  ok((await status(p.reviewer, id, "Return to analysis", "Need more samples")) === "ok", "reviewer returns the case with a reason");
  ok((await status(p.reviewer, id, "Close")) === "unavailable", "reviewer is not offered Close");

  // 6. Observer is read-only
  await p.auditor.goto(caseUrl(id, "/notes"));
  ok((await p.auditor.locator("#body").count()) === 0 && (await p.auditor.content()).includes("Collected 14 posts"), "observer reads notes but cannot add them");
  await p.auditor.goto(caseUrl(id));
  ok((await p.auditor.locator("#title").count()) === 0 && (await p.auditor.locator("#to").count()) === 0, "observer cannot edit or change status");

  // 7. Lead closes, reopens, closes and archives
  ok((await status(p.lead, id, "Closed", "Attribution complete")) === "ok", "lead closes the case");
  await p.lead.goto(caseUrl(id, "/tasks"));
  ok((await p.lead.locator("#dueAt").count()) === 0, "closed case: no new tasks");
  await p.lead.goto(caseUrl(id, "/notes"));
  ok((await p.lead.locator("#body").count()) === 1, "closed case: notes still allowed");
  ok((await status(p.lead, id, "Reopen", "New evidence")) === "ok", "lead reopens the case");
  await p.lead.goto(caseUrl(id, "/team"));
  const row = p.lead.locator("tr", { hasText: users.analyst.name });
  await row.getByRole("button", { name: "Remove" }).click();
  await settle(p.lead);
  const gone = await p.analyst.goto(caseUrl(id));
  ok(gone.status() === 404, "removed member loses access immediately (404)");
  ok((await status(p.lead, id, "Closed", "Done")) === "ok", "lead closes again");
  ok((await status(p.lead, id, "Archive", "Retention")) === "ok", "lead archives the case");
  await p.lead.goto(caseUrl(id, "/notes"));
  ok((await p.lead.locator("#body").count()) === 0 && (await p.lead.getByText("archived and read-only").isVisible()), "archived case is read-only");
  await p.lead.goto(caseUrl(id, "/activity"));
  const act = await p.lead.content();
  ok(["Need more samples", "Attribution complete", "New evidence", "Retention"].every((s) => act.includes(s)), "status history shows every transition with reasons");
  await p.lead.screenshot({ path: path.join(shots, "m2-03-activity.png"), fullPage: true });
  await p.sup.goto(BASE + "/");
  ok(!(await p.sup.content()).includes(ref), "archived case hidden from the default list");
  await p.sup.goto(BASE + "/?status=ARCHIVED");
  ok((await p.sup.content()).includes(ref), "archived case listed under the Archived filter");

  // 8. Removing a member revokes access immediately
  await p.sup.goto(caseUrl(id, "/team"));
  ok((await p.sup.locator("text=Remove").count()) === 0, "archived case: team is frozen");

  // 9. Audit: no case content, chain intact
  await p.auditor.goto(BASE + "/audit?action=case.");
  const audit = await p.auditor.content();
  ok(audit.includes("case.create") && audit.includes("case.status.change") && audit.includes("case.member.add"), "case events in the global audit log");
  ok(!audit.includes(TITLE) && !audit.includes("Collected 14 posts") && !audit.includes("Need more samples"), "audit log contains no case titles, notes or reasons");
  const v = await (await p.auditor.request.get(BASE + "/api/audit/verify")).json();
  ok(v.intact === true, `audit chain intact (head ${v.head?.seq})`);

  await browser.close();
  process.exit(done());
})().catch(async (e) => { console.error(e); await browser?.close(); process.exit(2); });
