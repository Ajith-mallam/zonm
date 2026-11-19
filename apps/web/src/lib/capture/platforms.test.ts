import { describe, expect, it } from "vitest";
import { ADAPTERS, CaptureInputError, itemError, parseSocialUrl, pickRequestedPost } from "./platforms";

const PFBID = "pfbid0DBux8z2EN9aPerBQtzfif5dadVo5m9SBQbJUpTsNMLhBRMmbkf889xWbC66SGvUfl";

describe("recognising links", () => {
  it.each([
    // Facebook
    [`https://www.facebook.com/bbcnews/posts/${PFBID}?__cft__[0]=x&__tn__=R`, "FACEBOOK", "POST", `https://www.facebook.com/bbcnews/posts/${PFBID}`],
    ["https://www.facebook.com/permalink.php?story_fbid=12345678&id=100012345678&ref=x", "FACEBOOK", "POST", "https://www.facebook.com/permalink.php?story_fbid=12345678&id=100012345678"],
    ["https://www.facebook.com/share/p/1AbCdEfGh2/", "FACEBOOK", "POST", "https://www.facebook.com/share/p/1AbCdEfGh2/"],
    ["https://www.facebook.com/ManaCelebritys", "FACEBOOK", "PROFILE", "https://www.facebook.com/ManaCelebritys"],
    ["facebook.com/ManaCelebritys/posts", "FACEBOOK", "PROFILE", "https://www.facebook.com/ManaCelebritys"],
    ["https://www.facebook.com/profile.php?id=100012345678", "FACEBOOK", "PROFILE", "https://www.facebook.com/profile.php?id=100012345678"],
    // Instagram
    ["https://www.instagram.com/p/Df7DAPfnCHT/?igsh=abc", "INSTAGRAM", "POST", "https://www.instagram.com/p/Df7DAPfnCHT/"],
    ["https://www.instagram.com/reel/Df61Gu2jLzX/", "INSTAGRAM", "POST", "https://www.instagram.com/p/Df61Gu2jLzX/"],
    ["https://www.instagram.com/bbcnews/p/Df7DAPfnCHT/", "INSTAGRAM", "POST", "https://www.instagram.com/p/Df7DAPfnCHT/"],
    ["instagram.com/bbcnews?hl=en", "INSTAGRAM", "PROFILE", "https://www.instagram.com/bbcnews/"],
    // TikTok
    ["https://www.tiktok.com/@bbcnews/video/7709853705176222998?lang=en", "TIKTOK", "POST", "https://www.tiktok.com/@bbcnews/video/7709853705176222998"],
    ["https://vm.tiktok.com/ZMabc123/", "TIKTOK", "POST", "https://vm.tiktok.com/ZMabc123/"],
    ["https://www.tiktok.com/@bbcnews", "TIKTOK", "PROFILE", "https://www.tiktok.com/@bbcnews"],
    // X
    ["https://x.com/BBCWorld/status/2123400505170796595?s=20", "X", "POST", "https://x.com/BBCWorld/status/2123400505170796595"],
    ["https://twitter.com/BBCWorld/status/2123400505170796595", "X", "POST", "https://x.com/BBCWorld/status/2123400505170796595"],
    ["https://x.com/BBCWorld", "X", "PROFILE", "https://x.com/BBCWorld"],
  ])("%s", (input, platform, kind, url) => {
    expect(parseSocialUrl(input)).toMatchObject({ platform, kind, url });
  });

  it("extracts handles for profiles", () => {
    expect(parseSocialUrl("https://www.tiktok.com/@bbcnews").handle).toBe("bbcnews");
    expect(parseSocialUrl("https://x.com/BBCWorld").handle).toBe("BBCWorld");
  });

  it.each([
    ["", /Paste/],
    ["https://www.youtube.com/watch?v=abc", /Only Facebook, Instagram, TikTok and X/],
    ["https://www.facebook.com/groups/123/posts/456789", /groups cannot be collected/],
    ["https://www.facebook.com/search/top?q=x", /not a public post or profile/],
    ["https://www.instagram.com/explore/tags/seychelles/", /not a public post or profile/],
    ["https://x.com/home", /not a public post or profile/],
    ["https://user:pw@x.com/BBCWorld", /password/],
  ])("refuses %s", (input, msg) => {
    expect(() => parseSocialUrl(input)).toThrow(CaptureInputError);
    expect(() => parseSocialUrl(input)).toThrow(msg);
  });
});

describe("scraper input", () => {
  it("asks for one post or the latest N", () => {
    expect(ADAPTERS.FACEBOOK.input(parseSocialUrl("https://www.facebook.com/ManaCelebritys"), 10)).toEqual({ startUrls: [{ url: "https://www.facebook.com/ManaCelebritys" }], resultsLimit: 10 });
    expect(ADAPTERS.INSTAGRAM.input(parseSocialUrl("https://www.instagram.com/p/Df7DAPfnCHT/"), 10)).toMatchObject({ directUrls: ["https://www.instagram.com/p/Df7DAPfnCHT/"], resultsLimit: 1 });
    expect(ADAPTERS.TIKTOK.input(parseSocialUrl("https://www.tiktok.com/@bbcnews"), 10)).toMatchObject({ profiles: ["bbcnews"], resultsPerPage: 10, profileSorting: "latest", excludePinnedPosts: true });
    expect(ADAPTERS.X.input(parseSocialUrl("https://x.com/BBCWorld"), 10)).toMatchObject({ startUrls: ["https://x.com/BBCWorld"], sort: "Latest" });
  });
});

describe("normalising scraper output (fields as returned live)", () => {
  it("Facebook", () => {
    expect(ADAPTERS.FACEBOOK.normalise({ postId: "1659248212905831", url: "https://www.facebook.com/bbcnews/posts/pfbid0D9", user: { name: "BBC News" }, time: "2026-11-13T05:01:03.000Z", text: "UK Prime Minister…\r\nRead more" })).toMatchObject({
      postId: "1659248212905831", author: "BBC News", postedAt: new Date("2026-11-13T05:01:03.000Z"), text: "UK Prime Minister…\nRead more",
    });
  });
  it("Instagram", () => {
    expect(ADAPTERS.INSTAGRAM.normalise({ id: "4033831102016397779", shortCode: "Df7DAPfnCHT", caption: "Myanmar committed genocide…", url: "https://www.instagram.com/p/Df7DAPfnCHT/", timestamp: "2026-11-19T12:09:51.000Z", ownerFullName: "BBC News", ownerUsername: "bbcnews" })).toMatchObject({
      postId: "4033831102016397779", author: "@bbcnews", authorName: "BBC News", text: "Myanmar committed genocide…", postedAt: new Date("2026-11-19T12:09:51.000Z"),
    });
  });
  it("TikTok", () => {
    expect(ADAPTERS.TIKTOK.normalise({ id: "7709853705176222998", text: "The verdict is…", createTimeISO: "2026-11-19T12:09:47.000Z", webVideoUrl: "https://www.tiktok.com/@bbcnews/video/7709853705176222998", authorMeta: { name: "bbcnews", nickName: "BBC News", profileUrl: "https://www.tiktok.com/@bbcnews" } })).toMatchObject({
      postId: "7709853705176222998", author: "@bbcnews", authorName: "BBC News", postedAt: new Date("2026-11-19T12:09:47.000Z"),
    });
  });
  it("X, including the createdAt format and retweets", () => {
    const p = ADAPTERS.X.normalise({ id: "2123400505170796595", url: "https://x.com/BBCWorld/status/2123400505170796595", text: "short", fullText: "US consortium wins huge Kenya mining deal", createdAt: "Thu Nov 19 12:58:25 +0000 2026", isRetweet: false, author: { userName: "BBCWorld", name: "BBC News (World)", url: "https://x.com/BBCWorld" } });
    expect(p).toMatchObject({ postId: "2123400505170796595", author: "@BBCWorld", text: "US consortium wins huge Kenya mining deal", isRepost: false });
    expect(p.postedAt?.toISOString()).toBe("2026-11-19T12:58:25.000Z");
    expect(ADAPTERS.X.normalise({ isRetweet: true, fullText: "RT" }).isRepost).toBe(true);
  });
});

describe("picking and errors", () => {
  it("picks the requested post, accepts a lone result, refuses unrelated sets", () => {
    const t = parseSocialUrl("https://x.com/BBCWorld/status/2123400505170796595");
    const want = { id: "2123400505170796595" };
    const other = { id: "1" };
    expect(pickRequestedPost([other, want], t)).toBe(want);
    expect(pickRequestedPost([other], t)).toBe(other); // lone result of a one-post request (pfbid drift, short links)
    expect(pickRequestedPost([other, { id: "2" }], t)).toBeNull();
  });
  it("recognises error items", () => {
    expect(itemError({ error: "not_found", errorDescription: "Private account" })).toBe("not_found");
    expect(itemError({ caption: "ok" })).toBeNull();
  });
});
