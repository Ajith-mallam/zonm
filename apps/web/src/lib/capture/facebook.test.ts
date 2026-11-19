import { describe, expect, it } from "vitest";
import { CaptureInputError, normaliseFacebookItem, parseFacebookPostUrl, pickRequestedPost } from "./facebook";

const PFBID = "pfbid0DBux8z2EN9aPerBQtzfif5dadVo5m9SBQbJUpTsNMLhBRMmbkf889xWbC66SGvUfl";

describe("facebook post URLs", () => {
  it.each([
    [`https://www.facebook.com/bbcnews/posts/${PFBID}?__cft__[0]=x&__tn__=R`, `https://www.facebook.com/bbcnews/posts/${PFBID}`, PFBID],
    ["m.facebook.com/somepage/posts/1234567890123", "https://www.facebook.com/somepage/posts/1234567890123", "1234567890123"],
    ["https://www.facebook.com/permalink.php?story_fbid=12345678&id=100012345678&ref=x", "https://www.facebook.com/permalink.php?story_fbid=12345678&id=100012345678", "12345678"],
    ["https://web.facebook.com/photo/?fbid=987654321&set=a.1", "https://www.facebook.com/photo/?fbid=987654321", "987654321"],
    ["https://www.facebook.com/reel/1122334455", "https://www.facebook.com/reel/1122334455", "1122334455"],
    ["https://www.facebook.com/share/p/1AbCdEfGh2/", "https://www.facebook.com/share/p/1AbCdEfGh2/", "1AbCdEfGh2"],
  ])("accepts %s", (input, url, key) => {
    expect(parseFacebookPostUrl(input)).toEqual({ url, key });
  });

  it.each([
    ["", /Paste/],
    ["https://twitter.com/x/status/1", /facebook.com/],
    ["https://www.facebook.com/bbcnews", /single post/],
    ["https://www.facebook.com/groups/123/posts/456789", /Group posts/],
    ["https://user:pw@www.facebook.com/a/posts/123456", /credentials/],
    ["javascript:alert(1)", /facebook.com|valid URL/],
  ])("rejects %s", (input, msg) => {
    expect(() => parseFacebookPostUrl(input)).toThrow(CaptureInputError);
    expect(() => parseFacebookPostUrl(input)).toThrow(msg);
  });
});

describe("apify items", () => {
  const item = {
    postId: "1234567890",
    url: `https://www.facebook.com/bbcnews/posts/${PFBID}`,
    text: "Line one\r\nline two",
    user: { name: "BBC News", profileUrl: "https://www.facebook.com/bbcnews" },
    time: "2026-11-13T05:01:03.000Z",
    facebookUrl: "https://www.facebook.com/bbcnews",
  };

  it("normalises the fields we keep", () => {
    expect(normaliseFacebookItem(item)).toEqual({
      postId: "1234567890",
      text: "Line one\nline two",
      author: "BBC News",
      authorUrl: "https://www.facebook.com/bbcnews",
      postedAt: new Date("2026-11-13T05:01:03.000Z"),
      url: item.url,
    });
    expect(normaliseFacebookItem({ timestamp: 1767225600, pageName: "Page" })).toMatchObject({ author: "Page", postedAt: new Date("2026-01-01T00:00:00Z"), text: "" });
  });

  it("picks the requested post, not a neighbour", () => {
    const other = { postId: "999", url: "https://www.facebook.com/bbcnews/posts/other" };
    const ref = parseFacebookPostUrl(item.url);
    expect(pickRequestedPost([other, item], ref)).toBe(item);
    expect(pickRequestedPost([other], ref)).toBeNull();
    expect(pickRequestedPost([other], parseFacebookPostUrl("https://www.facebook.com/share/p/1AbCdEfGh2/"))).toBe(other);
  });
});
