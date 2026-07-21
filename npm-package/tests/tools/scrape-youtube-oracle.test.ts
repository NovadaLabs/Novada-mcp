/**
 * Identity oracle (TOW2-305) — proves novada_scrape_youtube never surfaces a DIFFERENT
 * video than requested as a success. Pinned to the 2026-07-21 independent-audit case:
 * requested dQw4w9WgXcQ (Rick Astley), backend returned tSi6Dn1H36Y ("Billie Jean").
 *
 * After the 2026-07-21 code review, the oracle was tightened twice:
 *   - scoped to the two video-METADATA ops only (video_by_url / video_by_id) — transcript /
 *     comments / download ops are NOT checked (their records may not echo the id, which would
 *     false-reject every valid call);
 *   - matches only IDENTITY fields (id/url), walking objects but NOT arrays — so a wrong
 *     result can't pass by echoing the requested id in a related_videos[] entry or a
 *     description (both were live bypasses of the earlier whole-blob substring match).
 *
 * Prove-the-tester: the wrong-target + bypass cases MUST throw; a matching id (incl. nested),
 * an unextractable id, the non-checked ops, other platforms, and empty records MUST NOT throw.
 */
import { describe, it, expect } from "vitest";
import { assertYouTubeIdentity, extractYouTubeVideoId } from "../../src/tools/scrape.js";

const VIDEO_BY_URL = "youtube_video-post_explore";
const VIDEO_BY_ID = "youtube_product-videoid";
const REQ = { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };

const WRONG = [{ id: "tSi6Dn1H36Y", title: "Michael Jackson - Billie Jean (Live) - 1983", url: "https://www.youtube.com/watch?v=tSi6Dn1H36Y" }];
const RIGHT = [{ id: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }];

describe("YouTube identity oracle (TOW2-305)", () => {
  it("extracts the video id from a video_id param and from URL forms", () => {
    expect(extractYouTubeVideoId({ video_id: "dQw4w9WgXcQ" })).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId({ url: "https://youtu.be/dQw4w9WgXcQ" })).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId({ url: "https://www.youtube.com/shorts/dQw4w9WgXcQ" })).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoId({ keyword: "music" })).toBeNull();
    expect(extractYouTubeVideoId(undefined)).toBeNull();
  });

  it("THROWS on the audit's wrong-target case (requested Rick Astley, got Billie Jean)", () => {
    expect(() => assertYouTubeIdentity("youtube.com", VIDEO_BY_URL, REQ, WRONG)).toThrowError(/wrong target/i);
  });

  it("passes when the returned record matches the requested id (top-level and nested)", () => {
    expect(() => assertYouTubeIdentity("youtube.com", VIDEO_BY_URL, REQ, RIGHT)).not.toThrow();
    // nested object (record.video.id) must be reached — no false-reject
    expect(() => assertYouTubeIdentity("youtube.com", VIDEO_BY_ID, { video_id: "dQw4w9WgXcQ" }, [{ video: { id: "dQw4w9WgXcQ" }, title: "Rick" }])).not.toThrow();
  });

  it("THROWS when a WRONG record only echoes the requested id in a related_videos[] array (bypass closed)", () => {
    const wrongWithRelated = [{
      id: "tSi6Dn1H36Y",
      title: "Billie Jean",
      url: "https://www.youtube.com/watch?v=tSi6Dn1H36Y",
      related_videos: [{ id: "dQw4w9WgXcQ", title: "Rick Astley" }],
    }];
    expect(() => assertYouTubeIdentity("youtube.com", VIDEO_BY_URL, REQ, wrongWithRelated)).toThrowError(/wrong target/i);
  });

  it("THROWS when a WRONG record only echoes the requested id in a description (bypass closed)", () => {
    const wrongWithDesc = [{
      id: "tSi6Dn1H36Y",
      title: "Billie Jean",
      url: "https://www.youtube.com/watch?v=tSi6Dn1H36Y",
      description: "see also https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }];
    expect(() => assertYouTubeIdentity("youtube.com", VIDEO_BY_URL, REQ, wrongWithDesc)).toThrowError(/wrong target/i);
  });

  it("no-op when the id can't be extracted (never false-rejects)", () => {
    expect(() => assertYouTubeIdentity("youtube.com", VIDEO_BY_URL, { url: "not-a-youtube-url" }, WRONG)).not.toThrow();
  });

  it("no-op for the NON-metadata ops (transcript/comments/download) — they aren't identity-checked", () => {
    expect(() => assertYouTubeIdentity("youtube.com", "youtube_transcript_id", { video_id: "dQw4w9WgXcQ" }, WRONG)).not.toThrow();
    expect(() => assertYouTubeIdentity("youtube.com", "youtube_comment_id", { video_id: "dQw4w9WgXcQ" }, WRONG)).not.toThrow();
    expect(() => assertYouTubeIdentity("youtube.com", "youtube_video-url", { url: REQ.url }, WRONG)).not.toThrow();
  });

  it("no-op for non-single-video ops and for other platforms", () => {
    expect(() => assertYouTubeIdentity("youtube.com", "youtube_video-post-keyword", { keyword: "music" }, WRONG)).not.toThrow();
    expect(() => assertYouTubeIdentity("amazon.com", "amazon_product_asin", { asin: "B0FAKE0000" }, WRONG)).not.toThrow();
  });

  it("no-op on empty records", () => {
    expect(() => assertYouTubeIdentity("youtube.com", VIDEO_BY_URL, { url: "https://youtu.be/dQw4w9WgXcQ" }, [])).not.toThrow();
  });
});
