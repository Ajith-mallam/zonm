// Social media platforms for capture: URL recognition (single post or
// profile/page), Apify scraper input, and normalisation of scraper output.
// Pure and unit-tested. Scraper fields verified live on 2026-11-19.
import type { Platform } from "@prisma/client";

export class CaptureInputError extends Error {}

export type CaptureKindValue = "POST" | "PROFILE";

/** What a pasted URL points to. `key` identifies a single post in scraper output. */
export type CaptureTarget = { platform: Platform; kind: CaptureKindValue; url: string; key: string; handle: string | null };

export type CapturedPost = {
  postId: string | null;
  text: string;
  /** Account handle or name, used as the document's author label. */
  author: string | null;
  authorName: string | null;
  authorUrl: string | null;
  postedAt: Date | null;
  url: string | null;
  /** Reposts are not the account's own words and are skipped. */
  isRepost: boolean;
};

type Item = Record<string, unknown>;

export type PlatformAdapter = {
  platform: Platform;
  label: string;
  actor: string;
  /** Event names the actor charges per returned item. */
  itemEvents: string[];
  parse(u: URL): CaptureTarget | null;
  input(t: CaptureTarget, limit: number): Record<string, unknown>;
  normalise(item: Item): CapturedPost;
};

// ───────────────────────────────────────────────────────────── helpers

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Item) : undefined);
const idOf = (v: unknown) => str(v) ?? (num(v) !== null ? String(v) : null);
const cleanText = (v: unknown) => (str(v) ?? "").replace(/\r\n?/g, "\n").trim();

function date(...vals: unknown[]): Date | null {
  for (const v of vals) {
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v);
    const n = num(v);
    if (n && n > 0) return new Date(n > 1e12 ? n : n * 1000);
  }
  return null;
}

const segments = (u: URL) => u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
const canon = (base: string, path: string, params?: Record<string, string>) => {
  const out = new URL(base + path);
  for (const [k, v] of Object.entries(params ?? {})) out.searchParams.set(k, v);
  return out.href;
};

// ──────────────────────────────────────────────────────────── Facebook

const FB_ID = /^(?:pfbid[0-9A-Za-z]{20,}|\d{5,25})$/;
const FB_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// First path segments that are not Pages (from the poc-apify normaliser).
const FB_NOT_PAGE = new Set(["events", "watch", "marketplace", "gaming", "login", "login.php", "logout.php", "sharer", "sharer.php", "hashtag", "people", "search", "friends", "messages", "notifications", "settings", "help", "policies", "privacy", "ads", "reels", "stories", "dialog", "plugins", "l.php", "home.php", "pages", "me", "bookmarks", "saved", "memories", "fundraisers", "jobs", "business", "checkpoint", "recover", "r.php", "media", "notes", "places", "pg"]);
const FB_TABS = new Set(["posts", "about", "photos", "videos", "reels", "community", "mentions", "reviews", "events", "followers", "live_videos", "shop"]);
const FB = "https://www.facebook.com";

const facebook: PlatformAdapter = {
  platform: "FACEBOOK",
  label: "Facebook",
  actor: "apify/facebook-posts-scraper",
  itemEvents: ["post"],
  parse(u) {
    const seg = segments(u);
    const q = u.searchParams;
    const s0 = seg[0]?.toLowerCase() ?? "";
    if (s0 === "groups") throw new CaptureInputError("Facebook groups cannot be collected. Only public Pages and their posts are supported.");
    const post = (path: string, key: string, params?: Record<string, string>): CaptureTarget => ({ platform: "FACEBOOK", kind: "POST", url: canon(FB, path, params), key, handle: null });
    if (seg.length >= 3 && seg[1].toLowerCase() === "posts" && FB_ID.test(seg[2])) return { ...post(`/${seg[0]}/posts/${seg[2]}`, seg[2]), handle: seg[0] };
    if (seg.length >= 3 && seg[1].toLowerCase() === "videos" && FB_ID.test(seg[2])) return { ...post(`/${seg[0]}/videos/${seg[2]}`, seg[2]), handle: seg[0] };
    if (s0 === "reel" && FB_ID.test(seg[1] ?? "")) return post(`/reel/${seg[1]}`, seg[1]);
    if (seg.length === 1 && ["permalink.php", "story.php"].includes(s0)) {
      const sid = q.get("story_fbid");
      const id = q.get("id");
      if (sid && FB_ID.test(sid) && id && /^\d{5,25}$/.test(id)) return post(`/${s0}`, sid, { story_fbid: sid, id });
    }
    if (["photo.php", "photo"].includes(s0) && FB_ID.test(q.get("fbid") ?? "")) return post("/photo/", q.get("fbid")!, { fbid: q.get("fbid")! });
    if (s0 === "watch" && FB_ID.test(q.get("v") ?? "")) return post("/watch/", q.get("v")!, { v: q.get("v")! });
    if (s0 === "share" && ["p", "v", "r"].includes(seg[1]?.toLowerCase() ?? "") && /^[0-9A-Za-z]{6,40}$/.test(seg[2] ?? "")) return post(`/share/${seg[1].toLowerCase()}/${seg[2]}/`, seg[2]);
    // Pages and public profiles.
    if (seg.length === 1 && s0 === "profile.php" && /^\d{5,25}$/.test(q.get("id") ?? "")) {
      return { platform: "FACEBOOK", kind: "PROFILE", url: canon(FB, "/profile.php", { id: q.get("id")! }), key: q.get("id")!, handle: q.get("id")! };
    }
    if (s0 === "p" && FB_SLUG.test(seg[1] ?? "")) return { platform: "FACEBOOK", kind: "PROFILE", url: canon(FB, `/p/${seg[1]}`), key: seg[1], handle: seg[1] };
    if (seg.length >= 1 && seg.length <= 2 && FB_SLUG.test(seg[0]) && !FB_NOT_PAGE.has(s0) && (seg.length === 1 || FB_TABS.has(seg[1].toLowerCase()))) {
      return { platform: "FACEBOOK", kind: "PROFILE", url: canon(FB, `/${seg[0]}`), key: seg[0], handle: seg[0] };
    }
    return null;
  },
  input: (t, limit) => ({ startUrls: [{ url: t.url }], resultsLimit: t.kind === "POST" ? 1 : limit }),
  normalise(it) {
    const user = obj(it.user);
    const page = it.pageName;
    return {
      postId: idOf(it.postId),
      text: cleanText(it.text),
      author: str(user?.name) ?? str(page) ?? str(obj(page)?.name),
      authorName: str(user?.name) ?? str(page) ?? null,
      authorUrl: str(it.facebookUrl) ?? str(user?.profileUrl),
      postedAt: date(it.time, it.timestamp),
      url: str(it.url) ?? str(it.topLevelUrl),
      isRepost: false,
    };
  },
};

// ─────────────────────────────────────────────────────────── Instagram

const IG = "https://www.instagram.com";
const IG_USER = /^[A-Za-z0-9._]{1,30}$/;
const IG_CODE = /^[A-Za-z0-9_-]{5,40}$/;
const IG_RESERVED = new Set(["explore", "accounts", "stories", "direct", "reels", "reel", "p", "tv", "about", "legal", "developer", "challenge", "web", "emails", "session", "privacy", "terms"]);

const instagram: PlatformAdapter = {
  platform: "INSTAGRAM",
  label: "Instagram",
  actor: "apify/instagram-scraper",
  itemEvents: ["result"],
  parse(u) {
    const seg = segments(u);
    // instagram.com/p/<code>, /reel/<code>, /tv/<code>, and /<user>/p/<code>
    const i = seg.findIndex((s) => ["p", "reel", "reels", "tv"].includes(s.toLowerCase()));
    if (i >= 0 && i <= 1 && IG_CODE.test(seg[i + 1] ?? "")) {
      return { platform: "INSTAGRAM", kind: "POST", url: canon(IG, `/p/${seg[i + 1]}/`), key: seg[i + 1], handle: i === 1 ? seg[0] : null };
    }
    if (seg.length >= 1 && seg.length <= 2 && IG_USER.test(seg[0]) && !IG_RESERVED.has(seg[0].toLowerCase())) {
      return { platform: "INSTAGRAM", kind: "PROFILE", url: canon(IG, `/${seg[0]}/`), key: seg[0], handle: seg[0] };
    }
    return null;
  },
  input: (t, limit) => ({ directUrls: [t.url], resultsType: "posts", resultsLimit: t.kind === "POST" ? 1 : limit, addParentData: false }),
  normalise(it) {
    const handle = str(it.ownerUsername);
    return {
      postId: idOf(it.id) ?? str(it.shortCode),
      text: cleanText(it.caption),
      author: handle ? `@${handle}` : str(it.ownerFullName),
      authorName: str(it.ownerFullName),
      authorUrl: handle ? `${IG}/${handle}/` : null,
      postedAt: date(it.timestamp),
      url: str(it.url) ?? (str(it.shortCode) ? `${IG}/p/${it.shortCode}/` : null),
      isRepost: false,
    };
  },
};

// ──────────────────────────────────────────────────────────────── TikTok

const TT = "https://www.tiktok.com";
const TT_USER = /^@[A-Za-z0-9._]{2,30}$/;

const tiktok: PlatformAdapter = {
  platform: "TIKTOK",
  label: "TikTok",
  actor: "clockworks/tiktok-scraper",
  itemEvents: ["result"],
  parse(u) {
    const seg = segments(u);
    const host = u.hostname.toLowerCase();
    // Short links (vm.tiktok.com/<code>, tiktok.com/t/<code>) resolve to a video.
    if ((host === "vm.tiktok.com" || host === "vt.tiktok.com") && /^[A-Za-z0-9]{5,20}$/.test(seg[0] ?? "")) {
      return { platform: "TIKTOK", kind: "POST", url: `https://${host}/${seg[0]}/`, key: seg[0], handle: null };
    }
    if (seg[0] === "t" && /^[A-Za-z0-9]{5,20}$/.test(seg[1] ?? "")) return { platform: "TIKTOK", kind: "POST", url: canon(TT, `/t/${seg[1]}/`), key: seg[1], handle: null };
    if (TT_USER.test(seg[0] ?? "")) {
      if (["video", "photo"].includes(seg[1]?.toLowerCase() ?? "") && /^\d{10,25}$/.test(seg[2] ?? "")) {
        return { platform: "TIKTOK", kind: "POST", url: canon(TT, `/${seg[0]}/${seg[1].toLowerCase()}/${seg[2]}`), key: seg[2], handle: seg[0].slice(1) };
      }
      if (seg.length === 1) return { platform: "TIKTOK", kind: "PROFILE", url: canon(TT, `/${seg[0]}`), key: seg[0].slice(1), handle: seg[0].slice(1) };
    }
    return null;
  },
  input: (t, limit) =>
    t.kind === "POST"
      ? { postURLs: [t.url], resultsPerPage: 1 }
      : { profiles: [t.handle], resultsPerPage: limit, profileScrapeSections: ["videos"], profileSorting: "latest", excludePinnedPosts: true },
  normalise(it) {
    const a = obj(it.authorMeta);
    const handle = str(a?.name);
    return {
      postId: idOf(it.id),
      text: cleanText(it.text),
      author: handle ? `@${handle}` : str(a?.nickName),
      authorName: str(a?.nickName),
      authorUrl: str(a?.profileUrl),
      postedAt: date(it.createTimeISO, it.createTime),
      url: str(it.webVideoUrl),
      isRepost: false,
    };
  },
};

// ────────────────────────────────────────────────────────────────── X

const XB = "https://x.com";
const X_USER = /^[A-Za-z0-9_]{1,15}$/;
const X_RESERVED = new Set(["home", "explore", "search", "i", "settings", "notifications", "messages", "compose", "login", "signup", "tos", "privacy", "hashtag", "intent", "share", "logout", "jobs"]);

const x: PlatformAdapter = {
  platform: "X",
  label: "X (Twitter)",
  actor: "apidojo/tweet-scraper",
  itemEvents: ["apify-default-dataset-item"],
  parse(u) {
    const seg = segments(u);
    if (seg.length >= 3 && X_USER.test(seg[0]) && seg[1].toLowerCase() === "status" && /^\d{5,25}$/.test(seg[2])) {
      return { platform: "X", kind: "POST", url: canon(XB, `/${seg[0]}/status/${seg[2]}`), key: seg[2], handle: seg[0] };
    }
    if (seg.length >= 1 && seg.length <= 2 && X_USER.test(seg[0]) && !X_RESERVED.has(seg[0].toLowerCase()) && (seg.length === 1 || ["with_replies", "media"].includes(seg[1].toLowerCase()))) {
      return { platform: "X", kind: "PROFILE", url: canon(XB, `/${seg[0]}`), key: seg[0], handle: seg[0] };
    }
    return null;
  },
  input: (t, limit) => ({ startUrls: [t.url], maxItems: t.kind === "POST" ? 1 : limit + 5, sort: "Latest" }),
  normalise(it) {
    const a = obj(it.author);
    const handle = str(a?.userName);
    return {
      postId: idOf(it.id),
      text: cleanText(it.fullText ?? it.text),
      author: handle ? `@${handle}` : str(a?.name),
      authorName: str(a?.name),
      authorUrl: str(a?.url),
      postedAt: date(it.createdAt),
      url: str(it.url),
      isRepost: it.isRetweet === true,
    };
  },
};

// ──────────────────────────────────────────────────────────── dispatch

const HOSTS: Record<string, PlatformAdapter> = {};
for (const h of ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "mbasic.facebook.com", "fb.com", "www.fb.com"]) HOSTS[h] = facebook;
for (const h of ["instagram.com", "www.instagram.com", "m.instagram.com"]) HOSTS[h] = instagram;
for (const h of ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]) HOSTS[h] = tiktok;
for (const h of ["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]) HOSTS[h] = x;

export const ADAPTERS: Record<string, PlatformAdapter> = { FACEBOOK: facebook, INSTAGRAM: instagram, TIKTOK: tiktok, X: x };
export const SUPPORTED_PLATFORMS = "Facebook, Instagram, TikTok and X (Twitter)";

/** Recognise a pasted link: which platform, and a single post or a profile/page. */
export function parseSocialUrl(input: string): CaptureTarget {
  let raw = input.trim();
  if (!raw) throw new CaptureInputError("Paste a link to a post or a profile.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CaptureInputError("That is not a valid link.");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new CaptureInputError("The link must start with http:// or https://.");
  if (u.username || u.password) throw new CaptureInputError("The link must not contain a user name or password.");
  const adapter = HOSTS[u.hostname.toLowerCase()];
  if (!adapter) throw new CaptureInputError(`Only ${SUPPORTED_PLATFORMS} links are supported.`);
  let t: CaptureTarget | null;
  try {
    t = adapter.parse(u);
  } catch (e) {
    // decodeURIComponent throws on broken %-escapes in the path.
    if (e instanceof URIError) throw new CaptureInputError("That is not a valid link (it contains broken %-encoding).");
    throw e;
  }
  if (!t) throw new CaptureInputError(`This ${adapter.label} link is not a public post or profile. Copy the link of the post, or of the profile/page itself.`);
  return t;
}

/** Pick the requested post from a one-post scrape (scrapers may return neighbours). */
export function pickRequestedPost(items: Item[], t: CaptureTarget): Item | null {
  // Only the post's own identifiers. Not "inputUrl": scrapers copy the
  // requested URL onto every item, so it would match neighbouring posts too.
  const hit = items.find((it) => ["postId", "id", "shortCode", "url", "topLevelUrl", "webVideoUrl"].some((k) => {
    const v = it[k];
    return (typeof v === "string" && v.includes(t.key)) || (typeof v === "number" && String(v) === t.key);
  }));
  if (hit) return hit;
  // We ask for exactly one post, so a single result is that post even when its
  // identifiers differ: Facebook issues a fresh pfbid on each page load
  // (verified live), and short links redirect to the real post URL.
  return items.length === 1 ? items[0] : null;
}

/** An item that reports a scraper error (private, missing, blocked) instead of a post. */
export function itemError(it: Item): string | null {
  return str(it.error) ?? str(it.errorDescription) ?? (it.noResults === true ? "No posts found." : null);
}
