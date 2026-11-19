// Facebook post URLs and Apify post items. Pure and unit-tested.
// Field mapping follows the poc-apify normaliser, verified against real output
// of apify/facebook-posts-scraper.

export class CaptureInputError extends Error {}

const HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "mbasic.facebook.com", "fb.com", "www.fb.com"]);
const ID = /^(?:pfbid[0-9A-Za-z]{20,}|\d{5,25})$/;

export type PostRef = { url: string; key: string };

/**
 * Validate a public Facebook post URL and return its canonical form plus a
 * key (post id, pfbid or share code) used to recognise the post in results.
 */
export function parseFacebookPostUrl(input: string): PostRef {
  let raw = input.trim();
  if (!raw) throw new CaptureInputError("Paste the post's URL.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CaptureInputError("That is not a valid URL.");
  }
  if (!["http:", "https:"].includes(u.protocol) || !HOSTS.has(u.hostname.toLowerCase())) {
    throw new CaptureInputError("Only facebook.com post URLs are supported.");
  }
  if (u.username || u.password) throw new CaptureInputError("The URL must not contain credentials.");
  const seg = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const q = u.searchParams;
  const canon = (path: string, params?: Record<string, string>) => {
    const out = new URL(`https://www.facebook.com${path}`);
    for (const [k, v] of Object.entries(params ?? {})) out.searchParams.set(k, v);
    return out.href;
  };

  if (seg[0]?.toLowerCase() === "groups") throw new CaptureInputError("Group posts are not supported. Only public posts on Pages and public profiles can be captured.");

  // facebook.com/<page>/posts/<id|pfbid>
  if (seg.length >= 3 && seg[1].toLowerCase() === "posts" && ID.test(seg[2])) return { url: canon(`/${seg[0]}/posts/${seg[2]}`), key: seg[2] };
  // facebook.com/<page>/videos/<id> and facebook.com/reel/<id>
  if (seg.length >= 3 && seg[1].toLowerCase() === "videos" && ID.test(seg[2])) return { url: canon(`/${seg[0]}/videos/${seg[2]}`), key: seg[2] };
  if (seg.length >= 2 && seg[0].toLowerCase() === "reel" && ID.test(seg[1])) return { url: canon(`/reel/${seg[1]}`), key: seg[1] };
  // permalink.php / story.php ?story_fbid=..&id=..
  if (seg.length === 1 && ["permalink.php", "story.php"].includes(seg[0].toLowerCase())) {
    const sid = q.get("story_fbid");
    const id = q.get("id");
    if (sid && ID.test(sid) && id && /^\d{5,25}$/.test(id)) return { url: canon(`/${seg[0].toLowerCase()}`, { story_fbid: sid, id }), key: sid };
  }
  // photo.php?fbid= / photo/?fbid= / watch/?v=
  if (["photo.php", "photo"].includes(seg[0]?.toLowerCase() ?? "") && q.get("fbid") && ID.test(q.get("fbid")!)) {
    return { url: canon("/photo/", { fbid: q.get("fbid")! }), key: q.get("fbid")! };
  }
  if (seg[0]?.toLowerCase() === "watch" && q.get("v") && ID.test(q.get("v")!)) return { url: canon("/watch/", { v: q.get("v")! }), key: q.get("v")! };
  // Share links: facebook.com/share/p/<code>/
  if (seg[0]?.toLowerCase() === "share" && ["p", "v", "r"].includes(seg[1]?.toLowerCase() ?? "") && /^[0-9A-Za-z]{6,40}$/.test(seg[2] ?? "")) {
    return { url: canon(`/share/${seg[1].toLowerCase()}/${seg[2]}/`), key: seg[2] };
  }
  throw new CaptureInputError("This does not look like a link to a single post. Open the post on Facebook and copy its link (for example …/posts/…).");
}

export type CapturedPost = {
  postId: string | null;
  text: string;
  author: string | null;
  authorUrl: string | null;
  postedAt: Date | null;
  url: string | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function normaliseFacebookItem(item: Record<string, unknown>): CapturedPost {
  const user = item.user as Record<string, unknown> | undefined;
  const page = item.pageName;
  const time = str(item.time);
  const ts = typeof item.timestamp === "number" ? item.timestamp : null;
  let postedAt: Date | null = null;
  if (time && !Number.isNaN(Date.parse(time))) postedAt = new Date(time);
  else if (ts && ts > 0) postedAt = new Date(ts > 1e12 ? ts : ts * 1000);
  return {
    postId: str(item.postId) ?? (typeof item.postId === "number" ? String(item.postId) : null),
    text: (str(item.text) ?? "").replace(/\r\n?/g, "\n").trim(),
    author: str(user?.name) ?? str(page) ?? str((page as Record<string, unknown> | undefined)?.name) ?? null,
    authorUrl: str(item.facebookUrl) ?? str(user?.profileUrl) ?? null,
    postedAt,
    url: str(item.url) ?? str(item.topLevelUrl) ?? null,
  };
}

/** Pick the requested post from the scraper's items (it may return neighbours). */
export function pickRequestedPost(items: Record<string, unknown>[], ref: PostRef): Record<string, unknown> | null {
  const hit = items.find((it) => [it.postId, it.url, it.topLevelUrl, it.inputUrl].some((v) => typeof v === "string" && v.includes(ref.key)) || String(it.postId) === ref.key);
  if (hit) return hit;
  // We ask for exactly one post URL, so a single result is that post even when
  // its identifiers differ: Facebook issues a fresh pfbid on each page load
  // (verified live: the requested and returned pfbid differed for the same
  // post), and share links redirect to the real post URL.
  if (items.length === 1) return items[0];
  return ref.url.includes("/share/") && items.length >= 1 ? items[0] : null;
}
