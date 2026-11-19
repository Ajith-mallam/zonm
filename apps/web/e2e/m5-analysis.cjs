// Analysis runs and results (M6 engine through the job queue, M10 results).
// Needs the demo data (npm run db:seed-demo), Redis, the worker (npm run worker)
// and the engine. On the demo case the questioned reviews were written in
// Candidate B's style, so B must come out on top.
const path = require("path");
const { BASE, ok, done, createUser, launch, onboard, submit, shots } = require("./lib.cjs");

async function openDemoCase(page) {
  await page.goto(BASE + "/?q=Beau+Vallon");
  await Promise.all([page.waitForURL(/\/cases\/c[a-z0-9]+$/), page.locator("table a", { hasText: "Beau Vallon" }).click()]);
  return page.url();
}

/** Start a run from the Analysis tab; returns the run page URL once finished. */
async function runAnalysis(page, caseUrl, { uncheck = [] } = {}) {
  await page.goto(caseUrl + "/analysis");
  for (const name of uncheck) await page.locator("label", { hasText: name }).locator('input[name="candidate"]').uncheck();
  const form = page.locator("form", { has: page.getByRole("button", { name: "Run analysis" }) });
  await Promise.all([page.waitForURL(/\/analysis\/c[a-z0-9]+$/, { timeout: 15000 }), form.getByRole("button", { name: "Run analysis" }).click()]);
  await page.getByTestId("verdict").or(page.getByText(/^(Failed|Cancelled):/)).first().waitFor({ timeout: 90000 });
  return page.url();
}

(async () => {
  const browser = await launch();
  const sup = createUser("sup", "SUPERVISOR");
  const outsider = createUser("outsider", "ANALYST");
  const auditor = createUser("auditor", "AUDITOR");
  const p = await onboard(browser, sup);
  const o = await onboard(browser, outsider);
  const caseUrl = await openDemoCase(p);

  // 1. Full run on the demo case: A, B and C
  const t0 = Date.now();
  const runUrl = await runAnalysis(p, caseUrl);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(await p.getByTestId("verdict").isVisible(), `run finished through the queue and worker (${secs}s)`);
  ok((await p.getByTestId("verdict").innerText()).trim() === "Candidate B", "verdict: Candidate B (the true author of the questioned reviews)");
  const main = await p.locator("main").innerText();
  ok(/Limited confidence/.test(main) && /Too little known writing for: Candidate C/.test(main), "grade capped at Limited because Candidate C has too little writing");
  ok(/100% of methods rank Candidate B first/.test(main), "reasons name candidates by pseudonym, all methods agree");
  const rows = await p.locator("table").first().locator("tbody tr").allInnerTexts();
  ok(rows[0].includes("Candidate B") && (rows[0].match(/✓/g) ?? []).length === 5, "B ranks first with the closest score under all 5 methods");
  ok(/Closed-set ranking/.test(main) && /provisional/.test(main), "closed-set and calibration caveats shown");
  const q = await p.getByRole("img", { name: /^Questioned:/ }).getAttribute("aria-label");
  ok(/English \d+%/.test(q) && !/Kreol/.test(q), `language mix of the questioned text (${q})`);
  const a = await p.getByRole("img", { name: /^Candidate A:/ }).getAttribute("aria-label");
  ok(/Kreol (9\d|100)%/.test(a), `Candidate A's writing identified as Kreol (${a})`);
  await p.locator("summary", { hasText: "Inputs" }).click();
  ok(/Inputs \(261 document versions\)/.test(await p.locator("main").innerText()), "run record lists all 261 document versions used");
  ok(/[0-9a-f]{64}/.test(await p.locator("main").innerText()), "settings hash recorded");
  await p.screenshot({ path: path.join(shots, "m5-01-result.png"), fullPage: true });

  // 2. Without C the grade is no longer capped
  await runAnalysis(p, caseUrl, { uncheck: ["Candidate C"] });
  const main2 = await p.locator("main").innerText();
  ok((await p.getByTestId("verdict").innerText()).trim() === "Candidate B" && /(Strong|Moderate) confidence/.test(main2), "A vs B only: B with a higher grade");

  // 3. Run history
  await p.goto(caseUrl + "/analysis");
  const hist = await p.locator("table").first().innerText();
  ok((hist.match(/Finished/g) ?? []).length >= 2 && hist.includes("Candidate B"), "both runs listed with their verdicts");

  // 4. Validation: a candidate without known writing cannot be selected; no candidates refused
  for (const name of ["Candidate A", "Candidate B", "Candidate C"]) await p.locator("label", { hasText: name }).locator('input[name="candidate"]').uncheck();
  const form = p.locator("form", { has: p.getByRole("button", { name: "Run analysis" }) });
  await submit(p, form, "Run analysis");
  ok(/at least one candidate/i.test(await form.locator('[role="alert"]').innerText()), "starting without candidates is refused");

  // 5. Access: someone outside the case cannot see the results
  ok((await o.goto(runUrl)).status() === 404, "outsider gets 404 on the results page");

  // 6. Audit
  await p.goto(BASE + "/audit?action=analysis");
  const audit = await p.locator("main").innerText();
  ok(audit.includes("analysis.run.request") && audit.includes("analysis.run.complete"), "run requests and completions audited");
  // Supervisors read the audit log; verifying the chain is an auditor (or admin) task.
  const au = await onboard(browser, auditor);
  const v = await (await au.request.get(BASE + "/api/audit/verify")).json();
  ok(v.intact === true, `audit chain intact (head ${v.head?.seq})`);

  await browser.close();
  process.exit(done());
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
