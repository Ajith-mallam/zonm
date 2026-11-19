// "Check a Facebook post": URL validation, the missing-token message, and the
// full capture pipeline with a fake provider (e2e/capture-fake.ts): raw data
// stored as evidence, text imported as questioned writing, automatic
// authorship check. Needs the demo data, Redis, the worker and the engine.
const { execFileSync } = require("child_process");
const path = require("path");
const { BASE, ok, done, createUser, launch, onboard, submit, alertText, shots } = require("./lib.cjs");

const WEB = path.resolve(__dirname, "..");
// Written in Candidate B's style (formal English with French), so the check should point to B.
const POST =
  "I must say that the service was disappointing. The room was, frankly, not as advertised; we received a view of the car park. " +
  "C'est vraiment dommage, because the location is excellent. However, the staff at the front desk were polite. " +
  "Honestly, the price is far too high for what one receives. I would not recommend this establishment to my colleagues. " +
  "Je ne reviendrai pas, malheureusement. Nevertheless, cleanliness was clearly not a priority. Overall, a rather poor experience.";

(async () => {
  const browser = await launch();
  const sup = createUser("sup", "SUPERVISOR");
  const p = await onboard(browser, sup);
  await p.goto(BASE + "/?q=Beau+Vallon");
  await Promise.all([p.waitForURL(/\/cases\/c[a-z0-9]+$/), p.locator("table a", { hasText: "Beau Vallon" }).click()]);
  const caseUrl = p.url();
  const caseId = caseUrl.split("/").pop();

  // 1. URL validation in the form
  const check = async (url) => {
    await p.goto(caseUrl + "/evidence");
    const form = p.locator("form", { has: p.locator("#post-url") });
    await form.locator("#post-url").fill(url);
    await submit(p, form, "Check post");
    return alertText(form);
  };
  ok(/Group posts are not supported/.test(await check("https://www.facebook.com/groups/123/posts/456789")), "group post URL refused with an explanation");
  ok(/single post/.test(await check("https://www.facebook.com/bbcnews")), "page URL (not a post) refused");
  ok(/facebook\.com/.test(await check("https://x.com/someone/status/1")), "non-Facebook URL refused");

  // 2. A valid URL goes to the worker; without an Apify token it fails clearly
  await p.goto(caseUrl + "/evidence");
  const form = p.locator("form", { has: p.locator("#post-url") });
  await form.locator("#post-url").fill("https://www.facebook.com/somepage/posts/1234567890123?__tn__=R");
  await Promise.all([p.waitForURL(/evidence\/capture\/c[a-z0-9]+$/), form.getByRole("button", { name: "Check post" }).click()]);
  ok((await p.locator("main").innerText()).includes("https://www.facebook.com/somepage/posts/1234567890123"), "job page shows the canonical URL (tracking parameters removed)");
  await p.getByText(/APIFY_TOKEN|Captured/).first().waitFor({ timeout: 30000 });
  const noToken = await p.locator("main").innerText();
  ok(process.env.APIFY_TOKEN ? true : /not set up yet: add APIFY_TOKEN/.test(noToken), "without an Apify token the check fails with setup instructions");

  // 3. Full pipeline with a fake provider
  // Run tsx through node directly (no shell), so the post text arrives as one argument.
  const tsx = path.join(WEB, "node_modules", "tsx", "dist", "cli.mjs");
  const jobId = execFileSync(process.execPath, [tsx, "--env-file=.env", "e2e/capture-fake.ts", caseId, sup.email, "https://www.facebook.com/anonymous.page/posts/1234567890123", POST, "Anonymous Page"], { cwd: WEB, encoding: "utf8" })
    .trim()
    .split("\n")
    .pop();
  await p.goto(`${caseUrl}/evidence/capture/${jobId}`);
  ok((await p.getByTestId("post-text").innerText()).startsWith("I must say that the service"), "post text captured and shown (the neighbouring post was ignored)");
  const main = await p.locator("main").innerText();
  ok(/Anonymous Page/.test(main) && /Stored as evidence/.test(main) && /[0-9a-f]{16}…/.test(main), "author, evidence storage and hash shown");
  await p.getByTestId("capture-verdict").waitFor({ timeout: 60000 });
  ok((await p.getByTestId("capture-verdict").innerText()).trim() === "Candidate B", "automatic authorship check points to Candidate B");
  await p.screenshot({ path: path.join(shots, "m6-01-capture.png"), fullPage: true });

  // 4. The captured post is ordinary questioned evidence with its raw data downloadable
  await p.locator("a", { hasText: "Open the document" }).click();
  await p.waitForURL(/evidence\/c[a-z0-9]+$/);
  const doc = await p.locator("main").innerText();
  ok(/Questioned/.test(doc) && /Facebook · SOCIAL_CAPTURE/.test(doc) && /facebook-post-1234567890123\.json/.test(doc), "document records platform, capture source and raw file");
  const href = await p.locator("a", { hasText: "facebook-post-1234567890123.json" }).getAttribute("href");
  const raw = JSON.parse((await (await p.request.get(BASE + href)).body()).toString("utf8"));
  ok(raw.item?.postId === "1234567890123" && raw.actor === "apify/facebook-posts-scraper" && raw.providerRunId === "fake-run-1", "raw provider record downloadable and verified");

  // 5. Audit
  await p.goto(BASE + "/audit?action=capture");
  const audit = await p.locator("main").innerText();
  ok(audit.includes("capture.request") && audit.includes("capture.complete") && audit.includes("capture.failed"), "capture requests, completion and failure audited");
  ok(!audit.includes("I must say that the service"), "post text not copied into the audit log");

  await browser.close();
  process.exit(done());
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
