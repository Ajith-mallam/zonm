// Demo data for development and client demonstrations. Fictional people only.
//   npm run db:seed-demo            (refuses to run twice or against a remote DB)
//
// Creates five demo users (password printed at the end; each must enrol in MFA
// at first sign-in) and four cases in different states. The main case has three
// candidates with synthetic known writing in distinct styles, and questioned
// reviews written in Candidate B's style, so later engine runs have a known
// right answer.
import type { Platform, Prisma, SourceType } from "@prisma/client";
import { recordAudit } from "../src/lib/audit";
import { allocateCaseReference } from "../src/lib/cases";
import { prisma, type Tx } from "../src/lib/db";
import { hashPassword } from "../src/lib/security/password";
import { countWords, sha256Hex as sha256 } from "../src/lib/text";

const DEMO_PASSWORD = "Sample-Kreol-Text-2026";
const DOMAIN = "demo.zonm.local";
const SEED = { userAgent: "cli:seed-demo" };

// ───────────────────────────────────────────────── deterministic text model

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Style = { sentences: string[]; endings: string[]; capitalise: boolean; joiner: string[]; perPost: [number, number] };

const STYLE_A: Style = {
  // Kreol Seselwa, lower case, heavy exclamation.
  sentences: [
    "mon ti reste dan sa lakaz la pandan en semenn", "lasanm ti sal e personn pa ti vin netwaye",
    "zot pa ti dir nou ki dilo so pa ti marse", "manze ti fret e i pa ti bon ditou",
    "nou ti pey tro ser pou en servis koumsa", "mon pa pou retourn laba zanmen",
    "sa bann dimoun pa respekte touris", "aswar ti annan tro bokou bri lo lari",
    "lapli ti antre dan lasanm e zot pa ti fer nanryen", "mon ti pe esper en pli bon akey",
    "patron la pa ti menm dir bonzour", "mon konseye zot pa al laba",
    "zot pran ou larzan e apre zot bliye ou", "si ou anvi dormi trankil pa al dan sa lakaz",
    "mon ti kriye resepsyon trwa fwa me personn pa ti reponn", "lakwizin ti sal e i ti santi move",
    "zot dir ou wifi i marse me i pa marse", "mon fanmir ti tro dezapwente",
    "nou ti bezwen sanz lasanm de fwa", "laplaz i bon me sa lakaz la i en dezas",
    "mon pa kapab rekomann sa landrwa", "pa al laba ou pou regrete",
    "mon ti war bann ravet dan saldeben", "personn pa ti la pou ed nou ek bagaz",
    "i pa korek sa ki zot fer", "ozordi mon pe dir zot laverite", "zot krwar nou pa konnen",
  ],
  endings: ["!!!", "!!", "!", " lol", ".", "!!!"],
  capitalise: false,
  joiner: [" "],
  perPost: [3, 7],
};

const STYLE_B: Style = {
  // Formal English with French insertions, careful punctuation.
  sentences: [
    "The room was, frankly, not as advertised", "I must say that the service was disappointing",
    "However, the staff at the front desk were polite", "C'est vraiment dommage, because the location is excellent",
    "We were promised a sea view; we received a view of the car park", "Le petit déjeuner était correct, sans plus",
    "I would not recommend this establishment to my colleagues", "Honestly, the price is far too high for what one receives",
    "The manager did not reply to any of my emails", "In my opinion, the owners should invest in basic maintenance",
    "The air conditioning, unfortunately, did not work for three nights", "Il faut dire que le personnel faisait de son mieux",
    "To be fair, the garden is well kept", "Nevertheless, cleanliness was clearly not a priority",
    "I have stayed in many guesthouses on Mahé; this was the worst", "Je ne reviendrai pas, malheureusement",
    "The bathroom required urgent attention", "We asked twice for fresh towels; nothing happened",
    "Overall, a rather poor experience", "One expects better at this price",
    "I trust the owners will take these comments seriously", "Quel dommage pour un si bel endroit",
  ],
  endings: ["."],
  capitalise: true,
  joiner: [" ", " ", " "],
  perPost: [3, 6],
};

const STYLE_C: Style = {
  // Code-mixed, emoji, elongation, chat style.
  sentences: [
    "sooo dezapwente 😡", "zot servis pa bon at all", "never again", "#BeauVallon",
    "mon ti tro sok 😤", "wifi pa ti marse 🙄", "the beach nice me lakaz la nooo",
    "worst stay ever 👎", "ki sa zot pe fer la", "pa al laba guys", "bann staff tro rude 😒",
    "omg sa saldeben 🤢", "mon pa pe zoke", "seriously pa vo lapenn", "lol zot krwar nou bet",
  ],
  endings: ["", "!!", " 😂", "??", "!!!"],
  capitalise: false,
  joiner: [" ", "\n"],
  perPost: [2, 5],
};

function makePosts(style: Style, seed: number, targetWords: number): string[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const posts: string[] = [];
  let words = 0;
  while (words < targetWords) {
    const n = style.perPost[0] + Math.floor(r() * (style.perPost[1] - style.perPost[0] + 1));
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      let s = pick(style.sentences);
      if (style.capitalise) s = s[0].toUpperCase() + s.slice(1);
      parts.push(s + pick(style.endings) + (i < n - 1 ? pick(style.joiner) : ""));
    }
    const post = parts.join("").trim();
    posts.push(post);
    words += countWords(post);
  }
  return posts;
}


// ───────────────────────────────────────────────────────────── seeding

type DocSpec = { text: string; role: "KNOWN" | "QUESTIONED"; candidateId?: string; platform: Platform; sourceType: SourceType; authorLabel: string; authoredAt: Date; title?: string };

async function addDocuments(tx: Tx, caseId: string, createdById: string, specs: DocSpec[]) {
  const docs = await tx.document.createManyAndReturn({
    data: specs.map((d) => ({
      caseId,
      role: d.role,
      candidateId: d.candidateId ?? null,
      sourceType: d.sourceType,
      title: d.title ?? null,
      originalText: d.text,
      sha256: sha256(d.text),
      wordCount: countWords(d.text),
      authorLabel: d.authorLabel,
      authoredAt: d.authoredAt,
      platform: d.platform,
      metadata: { seed: "demo" } satisfies Prisma.InputJsonValue,
      createdById,
    })),
    select: { id: true, originalText: true, sha256: true, wordCount: true },
  });
  await tx.documentVersion.createMany({
    data: docs.map((d) => ({ documentId: d.id, version: 1, change: "ORIGINAL" as const, text: d.originalText, sha256: d.sha256, wordCount: d.wordCount, createdById })),
  });
  return docs.length;
}

const day = (base: string, i: number) => new Date(new Date(base).getTime() + i * 86_400_000 * 1.7);

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !process.argv.includes("--allow-remote")) {
    throw new Error("Refusing to seed a non-local database (pass --allow-remote to override).");
  }
  if (await prisma.case.findFirst({ where: { title: { startsWith: "[DEMO]" } } })) {
    console.log("Demo data already present; nothing to do.");
    return;
  }

  const hash = await hashPassword(DEMO_PASSWORD);
  const people = [
    ["supervisor", "Marie Laporte", "SUPERVISOR"],
    ["lead", "Jean-Paul Hoareau", "ANALYST"],
    ["analyst", "Nadia Pillay", "ANALYST"],
    ["reviewer", "Ravi Esparon", "REVIEWER"],
    ["auditor", "Lisa Morel", "AUDITOR"],
  ] as const;

  const summary = await prisma.$transaction(
    async (tx) => {
      const u: Record<string, { id: string; email: string }> = {};
      for (const [key, name, role] of people) {
        const email = `${key}@${DOMAIN}`;
        u[key] = await tx.user.upsert({
          where: { email },
          create: { email, name: `${name} (demo)`, role, passwordHash: hash, mustChangePassword: false },
          update: {},
          select: { id: true, email: true },
        });
        await recordAudit(tx, { action: "user.create", entityType: "User", entityId: u[key].id, ...SEED, details: { email, role, seed: "demo" } });
      }

      const mkCase = async (title: string, description: string, priority: "LOW" | "NORMAL" | "HIGH" | "URGENT", leadKey: string, team: [string, "ANALYST" | "REVIEWER" | "OBSERVER"][]) => {
        const reference = await allocateCaseReference(tx);
        const c = await tx.case.create({ data: { reference, title, description, priority, createdById: u.supervisor.id, leadId: u[leadKey].id } });
        await tx.caseMember.create({ data: { caseId: c.id, userId: u[leadKey].id, role: "LEAD", addedById: u.supervisor.id } });
        for (const [k, role] of team) await tx.caseMember.create({ data: { caseId: c.id, userId: u[k].id, role, addedById: u[leadKey].id } });
        await tx.caseStatusChange.create({ data: { caseId: c.id, toStatus: "OPEN", changedById: u.supervisor.id, reason: "Case created" } });
        await recordAudit(tx, { action: "case.create", entityType: "Case", entityId: c.id, caseId: c.id, ...SEED, details: { reference, priority, seed: "demo" } });
        return c;
      };
      const move = async (caseId: string, from: "OPEN" | "IN_ANALYSIS" | "UNDER_REVIEW" | "CLOSED", to: "IN_ANALYSIS" | "UNDER_REVIEW" | "CLOSED" | "ARCHIVED" | "OPEN", by: string, reason: string | null) => {
        await tx.case.update({ where: { id: caseId }, data: { status: to, closedAt: to === "CLOSED" ? new Date() : undefined } });
        await tx.caseStatusChange.create({ data: { caseId, fromStatus: from, toStatus: to, changedById: u[by].id, reason } });
        await recordAudit(tx, { action: "case.status.change", entityType: "Case", entityId: caseId, caseId, ...SEED, details: { from, to, seed: "demo" } });
      };
      const candidate = async (caseId: string, pseudonym: string, notes: string, handles: [Platform, string, string?][], identity?: { realName: string; dob?: string; ref?: string }) => {
        const c = await tx.candidate.create({ data: { caseId, pseudonym, notes, createdById: u.lead.id } });
        for (const [platform, handle, profileUrl] of handles) await tx.candidateHandle.create({ data: { candidateId: c.id, platform, handle, profileUrl } });
        if (identity) {
          await tx.candidateIdentity.create({
            data: {
              candidateId: c.id,
              realName: identity.realName,
              dateOfBirth: identity.dob ? new Date(identity.dob) : null,
              legalBasis: "Demo data: fictional person. In real cases, state the statutory power or warrant here.",
              legalReference: identity.ref ?? null,
              recordedById: u.supervisor.id,
            },
          });
        }
        await recordAudit(tx, { action: "candidate.create", entityType: "Candidate", entityId: c.id, caseId, ...SEED, details: { seed: "demo", identity: !!identity } });
        return c;
      };

      // ── Case 1: the main worked example
      const c1 = await mkCase(
        "[DEMO] Anonymous defamatory reviews — Beau Vallon guesthouse",
        "A guesthouse owner reports a series of anonymous reviews posted on a booking site between March and May 2026. Three people with a known dispute with the owner have been identified as candidates. Known writing has been collected from their public posts, e-mails and a WhatsApp group export.",
        "HIGH",
        "lead",
        [["analyst", "ANALYST"], ["reviewer", "REVIEWER"], ["auditor", "OBSERVER"]],
      );
      await move(c1.id, "OPEN", "IN_ANALYSIS", "lead", null);
      const a = await candidate(c1.id, "Candidate A", "Former employee; dismissed in January 2026. Posts mainly in Kreol on Facebook.", [["FACEBOOK", "jp.lafors.92", "https://www.facebook.com/jp.lafors.92"], ["PHONE", "+2482512345"]], { realName: "Jacques Dubignon (fictional)", dob: "1992-04-17", ref: "DEMO/W/2026/014" });
      const b = await candidate(c1.id, "Candidate B", "Competing guesthouse owner. Writes in English and French; formal register.", [["EMAIL", "contact@demo-anse-guesthouse.sc"], ["INSTAGRAM", "ansevillas.sc", "https://www.instagram.com/ansevillas.sc"]], { realName: "Sophie Vidot (fictional)", dob: "1979-11-02", ref: "DEMO/W/2026/015" });
      const c = await candidate(c1.id, "Candidate C", "Neighbour; noise complaints since 2025. Only a short WhatsApp export so far.", [["WHATSAPP", "+2482798765"]]);

      const counts: Record<string, number> = {};
      counts.A = await addDocuments(tx, c1.id, u.analyst.id, makePosts(STYLE_A, 101, 6000).map((text, i) => ({ text, role: "KNOWN", candidateId: a.id, platform: "FACEBOOK", sourceType: "SOCIAL_CAPTURE", authorLabel: "jp.lafors.92", authoredAt: day("2025-06-01", i) })));
      counts.B = await addDocuments(tx, c1.id, u.analyst.id, makePosts(STYLE_B, 202, 2600).map((text, i) => ({ text, role: "KNOWN", candidateId: b.id, platform: "EMAIL", sourceType: "TXT", authorLabel: "contact@demo-anse-guesthouse.sc", authoredAt: day("2025-09-01", i), title: `E-mail ${i + 1}` })));
      counts.C = await addDocuments(tx, c1.id, u.analyst.id, makePosts(STYLE_C, 303, 450).map((text, i) => ({ text, role: "KNOWN", candidateId: c.id, platform: "WHATSAPP", sourceType: "WHATSAPP", authorLabel: "+2482798765", authoredAt: day("2026-01-10", i) })));
      counts.Q = await addDocuments(tx, c1.id, u.analyst.id, makePosts(STYLE_B, 999, 380).map((text, i) => ({ text, role: "QUESTIONED", platform: "OTHER", sourceType: "PASTE", authorLabel: "Anonymous traveller", authoredAt: day("2026-03-04", i * 6), title: `Review ${i + 1}` })));
      for (const [k, n] of Object.entries(counts)) {
        await recordAudit(tx, { action: "document.import", entityType: "Case", entityId: c1.id, caseId: c1.id, ...SEED, details: { set: k, documents: n, seed: "demo" } });
      }
      for (const [author, body] of [
        ["lead", "Owner provided screenshots of all 7 reviews. Booking site confirmed the reviews came from 3 different accounts created the same week."],
        ["analyst", "Known writing collected: A from public Facebook posts (2025-26), B from e-mails supplied by the tourism board, C from a neighbourhood WhatsApp export. C's sample is too small; requested more."],
      ] as const) {
        await tx.caseNote.create({ data: { caseId: c1.id, authorId: u[author].id, body } });
      }
      await tx.caseTask.createMany({
        data: [
          { caseId: c1.id, title: "Obtain more known writing for Candidate C", assigneeId: u.analyst.id, status: "IN_PROGRESS", dueAt: new Date("2026-12-01"), createdById: u.lead.id },
          { caseId: c1.id, title: "Run attribution once C has 1,000+ words", assigneeId: u.lead.id, status: "TODO", createdById: u.lead.id },
          { caseId: c1.id, title: "Record warrant references for A and B", assigneeId: u.lead.id, status: "DONE", createdById: u.supervisor.id },
        ],
      });

      // ── Case 2: just opened
      const c2 = await mkCase(
        "[DEMO] Anonymous WhatsApp messages — Praslin school",
        "Parents' group received anonymous messages criticising a teacher. Two candidates identified; no known writing collected yet.",
        "NORMAL",
        "analyst",
        [["lead", "ANALYST"]],
      );
      await candidate(c2.id, "Candidate A", "Parent in the group.", [["WHATSAPP", "+2482700001"]]);
      await candidate(c2.id, "Candidate B", "Former staff member.", [["FACEBOOK", "praslin.voice"]]);
      await tx.caseTask.create({ data: { caseId: c2.id, title: "Request the group chat export from the school", assigneeId: u.analyst.id, dueAt: new Date("2026-11-28"), createdById: u.analyst.id } });

      // ── Case 3: closed
      const c3 = await mkCase("[DEMO] Fake page impersonating a public official", "Page removed by the platform after the report. Kept for reference.", "URGENT", "lead", [["reviewer", "REVIEWER"]]);
      await move(c3.id, "OPEN", "IN_ANALYSIS", "lead", null);
      await move(c3.id, "IN_ANALYSIS", "UNDER_REVIEW", "lead", null);
      await move(c3.id, "UNDER_REVIEW", "CLOSED", "lead", "Platform removed the page; no further action requested by the complainant.");

      // ── Case 4: archived
      const c4 = await mkCase("[DEMO] Forum harassment (2025)", "Historic case retained under the retention schedule.", "LOW", "lead", []);
      await move(c4.id, "OPEN", "CLOSED", "lead", "Complainant withdrew.");
      await move(c4.id, "CLOSED", "ARCHIVED", "supervisor", "Retention: archived after 6 months.");

      return { refs: [c1.reference, c2.reference, c3.reference, c4.reference], counts };
    },
    { timeout: 60_000 },
  );

  console.log(`Demo cases: ${summary.refs.join(", ")}`);
  console.log(`Main case documents: A=${summary.counts.A}, B=${summary.counts.B}, C=${summary.counts.C} known; ${summary.counts.Q} questioned`);
  console.log(`Demo users (password "${DEMO_PASSWORD}", MFA set up at first sign-in):`);
  for (const [key, name, role] of people) console.log(`  ${key}@${DOMAIN}  ${name}  ${role}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
