// Collecting social media posts (Facebook, Instagram, TikTok, X): link
// recognition, latest-10 from a profile, single posts, questioned vs known
// writing, skipping posts already collected, automatic authorship check, raw
// data kept as evidence. The scraper is faked (e2e/capture-fake.ts); the rest
// is the production path. Needs the demo data, Redis, the worker and the engine.
const { execFileSync } = require("child_process");
const path = require("path");
const { BASE, RUN, ok, done, createUser, launch, onboard, submit, alertText, shots } = require("./lib.cjs");

const WEB = path.resolve(__dirname, "..");
const TSX = path.join(WEB, "node_modules", "tsx", "dist", "cli.mjs");

/** Run a capture with the fake scraper; returns the job id. */
function fakeCapture(caseId, email, url, use, posts) {
  return execFileSync(process.execPath, [TSX, "--env-file=.env", "e2e/capture-fake.ts", caseId, email, url, use, JSON.stringify(posts)], { cwd: WEB, encoding: "utf8" }).trim().split("\n").pop();
}

// Posts in Candidate B's style (formal English with French) for the demo case.
const B = [
  "I must say that the service was disappointing", "The room was, frankly, not as advertised", "C'est vraiment dommage, because the location is excellent",
  "However, the staff at the front desk were polite", "Honestly, the price is far too high for what one receives", "I would not recommend this establishment to my colleagues",
  "Je ne reviendrai pas, malheureusement", "Nevertheless, cleanliness was clearly not a priority", "Overall, a rather poor experience", "One expects better at this price",
  "The manager did not reply to any of my emails", "In my opinion, the owners should invest in basic maintenance",
];
const bPosts = (author) =>
  Array.from({ length: 12 }, (_, i) => ({
    id: `${Date.now()}${i}`,
    text: `${B[i]}. ${B[(i + 3) % 12]}; ${B[(i + 7) % 12].toLowerCase()}. ${RUN}-${i}`,
    author,
    at: new Date(Date.UTC(2026, 10, 18, 12 - i)).toISOString(), // post 0 is the newest
  }));

(async () => {
  const browser = await launch();
  const sup = createUser("sup", "SUPERVISOR");
  const p = await onboard(browser, sup);
  await p.goto(BASE + "/?q=Beau+Vallon");
  await Promise.all([p.waitForURL(/\/cases\/c[a-z0-9]+$/), p.locator("table a", { hasText: "Beau Vallon" }).click()]);
  const demoUrl = p.url();
  const demoId = demoUrl.split("/").pop();

  // 1. Link recognition in the form (refusals happen before anything is queued)
  const tryLink = async (url) => {
    await p.goto(demoUrl + "/evidence");
    const form = p.locator("form", { has: p.locator("#post-url") });
    await form.locator("#post-url").fill(url);
    await submit(p, form, "Collect posts");
    return { error: await alertText(form), url: p.url() };
  };
  ok(/Only Facebook, Instagram, TikTok and X/.test((await tryLink("https://www.youtube.com/watch?v=abc")).error), "unsupported platform refused, supported ones listed");
  ok(/groups cannot be collected/.test((await tryLink("https://www.facebook.com/groups/123/posts/456789")).error), "Facebook group refused with an explanation");
  ok(/not a public post or profile/.test((await tryLink("https://www.instagram.com/explore/tags/seychelles/")).error), "Instagram explore page refused");
  if (!process.env.APIFY_TOKEN) {
    const r = await tryLink("https://www.facebook.com/ManaCelebritys");
    ok(/evidence\/capture\//.test(r.url), "a Facebook page link is accepted (profile collection)");
  } else {
    console.log("(live scraper configured: page-link acceptance is covered by unit tests, no paid call made)");
  }

  // 2. Facebook page -> latest 10 posts as questioned writing -> automatic authorship check
  const page = `TestPage${RUN}`;
  const pagePosts = bPosts(page); // the same posts (same ids) are reused below
  const job1 = fakeCapture(demoId, sup.email, `https://www.facebook.com/${page}`, "questioned", pagePosts);
  await p.goto(`${demoUrl}/evidence/capture/${job1}`);
  ok(/10 new posts imported/.test(await p.getByTestId("capture-summary").innerText()), "page link: the latest 10 of 12 posts imported");
  const texts = await p.getByTestId("post-text").allInnerTexts();
  ok(texts.length === 10 && texts.some((t) => t.endsWith(`${RUN}-0`)) && !texts.some((t) => t.endsWith(`${RUN}-11`) || t.endsWith(`${RUN}-10`)), "the two oldest posts were left out");
  await p.getByTestId("capture-verdict").waitFor({ timeout: 60000 });
  ok((await p.getByTestId("capture-verdict").innerText()).trim() === "Candidate B", "automatic authorship check of the 10 posts points to Candidate B");
  await p.screenshot({ path: path.join(shots, "m6-01-profile.png"), fullPage: true });

  // 3. Same page again: nothing new
  const job2 = fakeCapture(demoId, sup.email, `https://www.facebook.com/${page}`, "questioned", pagePosts);
  await p.goto(`${demoUrl}/evidence/capture/${job2}`);
  ok(/0 new posts imported.*10 already in this case/.test(await p.getByTestId("capture-summary").innerText()), "collecting the same page again imports nothing new");

  // 4. Instagram and TikTok single posts, X profile
  const ig = fakeCapture(demoId, sup.email, `https://www.instagram.com/p/Cig${RUN}/`, "questioned", [{ id: `ig${RUN}`, text: `${B[0]}. ${B[4]}. ${RUN} instagram`, author: `ig${RUN}`, at: "2026-11-18T10:00:00Z" }]);
  await p.goto(`${demoUrl}/evidence/capture/${ig}`);
  ok(/Instagram post/.test(await p.locator("main").innerText()) && /1 new post imported/.test(await p.getByTestId("capture-summary").innerText()), "Instagram single post collected");
  const tt = fakeCapture(demoId, sup.email, `https://www.tiktok.com/@tt${RUN}/video/77098537051762${String(Date.now()).slice(-5)}`, "questioned", [{ id: `9${Date.now()}`, text: `${B[2]}. ${RUN} tiktok`, author: `tt${RUN}`, at: "2026-11-18T09:00:00Z" }]);
  await p.goto(`${demoUrl}/evidence/capture/${tt}`);
  ok(/TikTok post/.test(await p.locator("main").innerText()) && /1 new post imported/.test(await p.getByTestId("capture-summary").innerText()), "TikTok single post collected");

  // 5. A candidate's own X profile as known writing (own case, so the demo corpus stays as seeded)
  await p.goto(BASE + "/cases/new");
  await p.fill("#title", `Known writing from X ${RUN}`);
  await Promise.all([p.waitForURL(/\/cases\/c[a-z0-9]+$/), p.click("text=Create case")]);
  const own = p.url();
  await p.goto(own + "/candidates");
  await Promise.all([p.waitForURL(/candidates\/c[a-z0-9]+$/), p.click("text=Add candidate >> nth=-1")]);
  const handle = `x${RUN}`.slice(0, 15);
  const xjob = fakeCapture(own.split("/").pop(), sup.email, `https://x.com/${handle}`, "known:Candidate A", bPosts(handle).slice(0, 10));
  await p.goto(`${own}/evidence/capture/${xjob}`);
  const xs = await p.locator("main").innerText();
  ok(/X \(Twitter\) profile/.test(xs) && /imported as known writing of Candidate A/.test(xs) && /10 new posts imported/.test(xs), "X profile collected as Candidate A's known writing");
  ok(!(await p.getByTestId("capture-verdict").count()), "no authorship check for known writing");
  await p.goto(own + "/candidates");
  const rowA = await p.locator("tbody tr", { hasText: "Candidate A" }).innerText();
  ok(/X \(Twitter\): x/.test(rowA) && /10 documents/.test(rowA), "the X account was added to Candidate A's handles and the posts count as known writing");

  // 6. Raw scraper data kept as evidence
  await p.goto(`${demoUrl}/evidence/capture/${job1}`);
  const href = await p.locator("a", { hasText: /facebook-profile-.*\.json/ }).getAttribute("href");
  const raw = JSON.parse((await (await p.request.get(BASE + href)).body()).toString("utf8"));
  ok(raw.platform === "FACEBOOK" && raw.kind === "PROFILE" && raw.items.length === 12 && raw.actor === "apify/facebook-posts-scraper", "raw scraper output (all 12 items) downloadable and verified");

  // 7. Audit
  await p.goto(BASE + "/audit?action=capture");
  const audit = await p.locator("main").innerText();
  ok(audit.includes("capture.complete") && /"kind":"PROFILE"/.test(audit) && /"imported":10/.test(audit), "captures audited with platform, kind and counts");
  ok(!audit.includes(B[0]), "post texts not copied into the audit log");

  await browser.close();
  process.exit(done());
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
