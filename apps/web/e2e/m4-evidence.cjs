// M4 evidence: upload of every format, author mapping, duplicate detection,
// versions, exclusion, download integrity (including on-disk tampering),
// permissions and audit content.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { BASE, RUN, ok, done, createUser, launch, onboard, settle, submit, alertText, shots } = require("./lib.cjs");
const { buildDocx, buildPdf, whatsappChat } = require("./fixtures.cjs");

const STORAGE = process.env.STORAGE_DIR ?? path.resolve(__dirname, "..", "storage");

/** Direct access to a stored evidence file, to simulate tampering (test only). */
function diskStore(file) {
  return {
    read: async () => fs.readFileSync(file),
    replace: async (bytes) => {
      fs.chmodSync(file, 0o666);
      fs.writeFileSync(file, bytes);
    },
  };
}
function blobStore(pathname) {
  const blob = require("@vercel/blob");
  return {
    read: async () => Buffer.from(await new Response((await blob.get(pathname, { access: "private", useCache: false })).stream).arrayBuffer()),
    // Blob objects are write-once; an attacker with the store token would delete and re-upload.
    replace: async (bytes) => {
      await blob.del(pathname);
      await blob.put(pathname, bytes, { access: "private", addRandomSuffix: false, contentType: "application/octet-stream" });
    },
  };
}
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** Upload a file through the real form; returns the URL the server redirected to. */
async function upload(page, caseUrl, name, buffer) {
  await page.goto(caseUrl + "/evidence");
  await page.setInputFiles('input[type="file"][name="file"]', { name, mimeType: "application/octet-stream", buffer });
  const before = page.url();
  // Success redirects to the preview; a rejection to /evidence?error=..., so the URL always changes.
  await Promise.all([page.waitForURL((u) => u.href !== before), page.click("text=Upload and preview")]);
  await settle(page);
  return page.url();
}

/** Choose a target for each author row on the import preview and import. */
async function importMapped(page, mapping) {
  const rows = page.locator("tbody tr", { has: page.locator('select[name^="t_"]') });
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const author = (await rows.nth(i).locator("td").first().innerText()).trim();
    if (mapping[author]) await rows.nth(i).locator("select").selectOption({ label: mapping[author] });
  }
  return importNow(page);
}
async function importNow(page) {
  const form = page.locator("form", { has: page.getByRole("button", { name: "Import" }) });
  await submit(page, form, "Import");
  // The server action redirects on success; wait for that or for an error message.
  // (Scope the error to the form: Next.js renders a page-wide role="alert" route announcer.)
  await Promise.race([page.waitForURL(/imported=/, { timeout: 15000 }), form.getByRole("alert").first().waitFor({ timeout: 15000 })]).catch(() => {});
  const m =/imported=(\d+)/.exec(page.url());
  return m ? Number(m[1]) : await alertText(page);
}

(async () => {
  const browser = await launch();
  const u = { sup: createUser("sup", "SUPERVISOR"), lead: createUser("lead", "ANALYST"), observer: createUser("observer", "AUDITOR") };
  const p = {};
  for (const [k, user] of Object.entries(u)) p[k] = await onboard(browser, user);

  // Setup: case led by `lead`, observer on the team, two candidates.
  await p.sup.goto(BASE + "/cases/new");
  await p.sup.fill("#title", `Evidence test ${RUN}`);
  await p.sup.selectOption("#leadId", { label: `${u.lead.name} (analyst)` });
  await Promise.all([p.sup.waitForURL(/\/cases\/c[a-z0-9]+$/), p.sup.click("text=Create case")]);
  const caseId = p.sup.url().split("/").pop();
  const C = `${BASE}/cases/${caseId}`;
  await p.lead.goto(C + "/team");
  const tf = p.lead.locator("form", { has: p.lead.locator("#userId") });
  await tf.locator("#userId").selectOption(await tf.locator("#userId option", { hasText: u.observer.name }).getAttribute("value"));
  await tf.locator("#role").selectOption("OBSERVER");
  await submit(p.lead, tf, "Add to team");
  for (let i = 0; i < 2; i++) {
    await p.lead.goto(C + "/candidates");
    await Promise.all([p.lead.waitForURL(/candidates\/c[a-z0-9]+$/), p.lead.click("text=Add candidate >> nth=-1")]);
  }
  const L = p.lead;

  // 1. WhatsApp export: per-author mapping
  const chat = Buffer.from(whatsappChat(RUN));
  const preview = await upload(L, C, "WhatsApp Chat with Guesthouse group.txt", chat);
  ok(/\/evidence\/import\/[a-f0-9]{24}$/.test(preview), "upload redirects to the import preview");
  const waFileId = preview.split("/").pop();
  const page1 = await L.locator("main").innerText();
  ok(page1.includes("WHATSAPP") && page1.includes(sha(chat)), "preview shows type and the file's SHA-256");
  ok(/Found 12 items with [\d,]+ words from 3 author/.test(page1),"12 messages from 3 authors (system lines and media skipped)");
  ok(page1.includes("and a second line follows\non the next line"), "multi-line message kept together");
  const n1 = await importMapped(L, { Marie: "Known writing of Candidate A", "Jean-Paul": "Questioned (unknown author)" });
  ok(n1 === 11, `imported Marie (5) as known A and Jean-Paul (6) as questioned; Ravi skipped (got ${n1})`);
  await L.screenshot({ path: path.join(shots, "m4-01-evidence.png"), fullPage: true });

  // 2. Same file again: duplicates detected
  await upload(L, C, "WhatsApp Chat with Guesthouse group (copy).txt", chat);
  const dupPage = await L.locator("main").innerText();
  ok(dupPage.includes("This exact file was uploaded before") && dupPage.includes("11 already in this case"), "re-upload: file and text duplicates flagged");
  const n2 = await importMapped(L, { Marie: "Known writing of Candidate A", "Jean-Paul": "Questioned (unknown author)" });
  ok(/already in this case/.test(String(n2)), "importing only duplicates is refused");

  // 3. CSV whose text column must be chosen by hand
  const csv = Buffer.from(`who,when,said\nSophie,2026-03-01T09:00:00Z,"The room was, frankly, not as advertised ${RUN}."\nSophie,2026-03-02T09:00:00Z,"Je ne reviendrai pas ${RUN}."\nOther,2026-03-03,"unrelated ${RUN}"\n`);
  await upload(L, C, "reviews.csv", csv);
  ok(/Could not find the text column/.test(await L.content()), "CSV without a recognisable text column explains itself");
  const opt = L.locator("form", { has: L.locator("#textField") });
  await opt.locator("#textField").selectOption("said");
  await opt.locator("#authorField").selectOption("who");
  await Promise.all([L.waitForURL(/textField=said/), opt.getByRole("button", { name: "Update preview" }).click()]);
  const n3 = await importMapped(L, { Sophie: "Known writing of Candidate B" });
  ok(n3 === 2, `CSV: chosen columns, Sophie's 2 rows imported for Candidate B (got ${n3})`);

  // 4. DOCX split into paragraphs, PDF as one document, Apify-style JSON
  await upload(L, C, "statement.docx", await buildDocx([`Mon pa konnen kifer ${RUN}.`, `Zot pa ti dir nou nanryen ${RUN}.`]));
  const sf = L.locator("form", { has: L.locator("#split") });
  await sf.locator("#split").selectOption("paragraph");
  await Promise.all([L.waitForURL(/split=paragraph/), sf.getByRole("button", { name: "Update preview" }).click()]);
  await L.selectOption("#target", "questioned");
  ok((await importNow(L)) === 2, "DOCX split into 2 paragraphs and imported");
  await upload(L, C, "letter.pdf", buildPdf([`The bathroom required urgent attention ${RUN}.`, "We asked twice for fresh towels."]));
  ok((await L.content()).includes("The bathroom required urgent attention"), "PDF text extracted");
  ok((await importNow(L)) === 1, "PDF imported as one questioned document");
  const json = Buffer.from(JSON.stringify([{ postId: `p1-${RUN}`, text: `Sa lakaz la i sal!!! ${RUN}`, user: { name: "jp.lafors.92" }, timestamp: 1767225600, url: "https://facebook.com/p/1" }]));
  await upload(L, C, "dataset_facebook-posts.json", json);
  ok(await importMapped(L, { "jp.lafors.92": "Known writing of Candidate A" }) === 1, "Apify-style JSON with nested author imported");

  // 5. Rejected uploads
  ok(/not a valid PDF/.test(decodeURIComponent(await upload(L, C, "fake.pdf", Buffer.from("hello")))), "renamed non-PDF rejected");
  ok(/Unsupported file type/.test(decodeURIComponent(await upload(L, C, "tool.exe", Buffer.from("MZ")))), "unsupported type rejected");

  // 6. Versions: partial exclusion keeps the original
  await L.goto(C + "/evidence?role=QUESTIONED&q=Jean-Paul");
  await Promise.all([L.waitForURL(/evidence\/c[a-z0-9]+$/), L.locator("tbody a", { hasText: "#" }).last().click()]);
  const docUrl = L.url();
  const originalSha = await L.getByTestId("original-sha").innerText();
  const before = await L.getByTestId("current-text").innerText();
  const vf = L.locator("form", { has: L.locator('textarea[name="text"]') });
  await vf.locator('textarea[name="text"]').fill(before.split("\n")[0]);
  await vf.locator("#reason").fill("Second line quotes another member");
  await submit(L, vf, "Save new version");
  ok((await L.getByTestId("current-text").innerText()) === before.split("\n")[0], "new version becomes the current text");
  ok((await L.getByTestId("original-sha").innerText()) === originalSha && (await L.locator("table").last().innerText()).includes("Partial exclusion"), "original hash unchanged; version history shows the change");

  // 7. Exclusion needs a reason and stops counting
  await L.goto(C + "/candidates");
  const wordsBefore = Number(((await L.locator("tbody tr", { hasText: "Candidate A" }).innerText()).match(/([\d,]+) words/) ?? [])[1]?.replace(/,/g, ""));
  await L.goto(C + "/evidence?role=KNOWN&q=Marie");
  await Promise.all([L.waitForURL(/evidence\/c[a-z0-9]+$/), L.locator("tbody a").first().click()]);
  const words = Number((await L.getByText(/^Version \d+ .* · \d+ words$/).innerText()).match(/(\d+) words$/)[1]);
  const ef = L.locator("form", { has: L.locator("#exreason") });
  await ef.locator("#exreason").fill("Forwarded text, not Marie's own words");
  await submit(L, ef, "Exclude");
  ok(await L.getByText("Excluded from analysis").isVisible(), "document excluded with a reason");
  await L.goto(C + "/candidates");
  const wordsAfter = Number(((await L.locator("tbody tr", { hasText: "Candidate A" }).innerText()).match(/([\d,]+) words/) ?? [])[1]?.replace(/,/g, ""));
  ok(wordsAfter === wordsBefore - words, `excluded words no longer count for the candidate (${wordsBefore} -> ${wordsAfter})`);

  // 8. Download integrity, then tamper with the stored file on disk
  const dl = await L.request.get(`${BASE}/api/cases/${caseId}/files/${waFileId}`);
  const body = await dl.body();
  ok(dl.status() === 200 && sha(body) === sha(chat) && dl.headers()["x-evidence-sha256"] === sha(chat), "download returns the exact original bytes");
  ok(/attachment/.test(dl.headers()["content-disposition"] ?? "") && dl.headers()["content-type"] === "application/octet-stream", "originals are served as downloads, never rendered");
  // The stored copy lives on local disk, or in Vercel Blob when STORAGE_DRIVER=blob.
  const store = process.env.STORAGE_DRIVER === "blob" ? blobStore(`evidence/${caseId}/${waFileId}.zne`) : diskStore(path.join(STORAGE, caseId, `${waFileId}.zne`));
  const raw = await store.read();
  ok(!raw.includes(Buffer.from("Bonzour tout dimoun")), `stored file is encrypted at rest (${process.env.STORAGE_DRIVER === "blob" ? "Vercel Blob" : "disk"})`);
  const tampered = Buffer.from(raw);
  tampered[tampered.length - 5] ^= 0xff;
  await store.replace(tampered);
  const bad = await L.request.get(`${BASE}/api/cases/${caseId}/files/${waFileId}`);
  ok(bad.status() === 500, `tampered file refused (status ${bad.status()})`);
  await store.replace(raw); // restore

  // 9. Permissions
  await p.observer.goto(C + "/evidence");
  ok((await p.observer.locator('input[type="file"]').count()) === 0, "observer has no upload form");
  const forced = await p.observer.request.post(`${BASE}/api/cases/${caseId}/evidence`, { multipart: { file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("sneaky upload") } }, maxRedirects: 0 });
  ok(forced.status() === 303 && /permission/.test(decodeURIComponent(forced.headers().location ?? "")), "observer upload refused by the server");
  await p.observer.goto(docUrl);
  ok((await p.observer.locator('textarea[name="text"]').count()) === 0 && (await p.observer.locator("#exreason").count()) === 0, "observer cannot version or exclude");

  // 10. Audit: events present, no evidence content
  await p.observer.goto(BASE + "/audit?action=document");
  const a1 = await p.observer.content();
  await p.observer.goto(BASE + "/audit?action=evidence");
  const a2 = await p.observer.content();
  ok(a1.includes("document.import") && a1.includes("document.version.create") && a1.includes("document.exclude"), "document events audited");
  ok(a2.includes("evidence.upload") && a2.includes("evidence.download") && a2.includes("evidence.integrity_failure"), "upload, download and the integrity failure audited");
  ok(![a1, a2].some((t) => t.includes("Bonzour tout dimoun") || t.includes("not as advertised") || t.includes("Forwarded text")), "no evidence text or reasons in the audit log");
  await L.goto(C + "/activity");
  ok((await L.content()).includes("INTEGRITY FAILURE"), "integrity failure visible in case activity");
  const v = await (await p.observer.request.get(BASE + "/api/audit/verify")).json();
  ok(v.intact === true, `audit chain intact (head ${v.head?.seq})`);

  await browser.close();
  process.exit(done());
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
