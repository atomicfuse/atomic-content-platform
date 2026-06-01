import type { ArticleVideo } from "@atomic-platform/shared-types";

/**
 * Extract the YouTube video ID from a URL.
 *
 * Handles:
 *   - https://www.youtube.com/watch?v=ID
 *   - https://youtu.be/ID
 *   - https://www.youtube.com/embed/ID
 *   - https://www.youtube-nocookie.com/embed/ID
 */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      // /watch?v=ID
      const v = u.searchParams.get("v");
      if (v) return v;
      // /embed/ID
      const embedMatch = /^\/embed\/([a-zA-Z0-9_-]+)/.exec(u.pathname);
      if (embedMatch) return embedMatch[1]!;
    }

    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      if (id) return id;
    }
  } catch {
    // invalid URL
  }
  return null;
}

function renderVideoEmbed(video: ArticleVideo): string {
  const videoId = extractYouTubeId(video.url);
  if (!videoId) return "";
  const originalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return (
    `<div class="video-embed" style="margin:1.5rem 0;">` +
    `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">` +
    `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}" ` +
    `style="position:absolute;top:0;left:0;width:100%;height:100%;" ` +
    `frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ` +
    `allowfullscreen loading="lazy"></iframe>` +
    `</div>` +
    `<p style="margin:0.35rem 0 0;font-size:0.8rem;color:#6b7280;">` +
    `Video via <a href="${originalUrl}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">YouTube</a>` +
    `</p>` +
    `</div>`
  );
}

/**
 * Inject embedded videos into the rendered article HTML body.
 *
 * - `before-content` videos are prepended to the body.
 * - `after-content` videos are appended to the body.
 * - `after-paragraph-N` videos are inserted after the Nth </p> tag (1-indexed).
 *   If N exceeds the paragraph count, the video is appended to the end.
 *
 * Uses the same </p>-counting pattern as injectInlineAds() and injectArticleScripts().
 */
export function injectVideos(
  body: string,
  videos: ArticleVideo[] | undefined,
): string {
  if (!videos || videos.length === 0) {
    return body;
  }

  const before: string[] = [];
  const after: string[] = [];
  const paragraph: Array<{ afterIndex: number; html: string }> = [];

  for (const v of videos) {
    const html = renderVideoEmbed(v);
    if (!html) continue;

    if (v.position === "before-content") {
      before.push(html);
    } else if (v.position === "after-content") {
      after.push(html);
    } else {
      const match = /^after-paragraph-(\d+)$/.exec(v.position);
      if (match) {
        const n = Number.parseInt(match[1]!, 10);
        if (Number.isFinite(n) && n > 0) {
          paragraph.push({ afterIndex: n, html });
        }
      }
    }
  }

  let result = body;

  // Inject paragraph-relative videos
  if (paragraph.length > 0) {
    const parts = result.split(/(<\/p>)/i);
    let pSeen = 0;
    const out: string[] = [];
    for (const part of parts) {
      out.push(part);
      if (part.toLowerCase() === "</p>") {
        pSeen += 1;
        const matches = paragraph.filter((p) => p.afterIndex === pSeen);
        for (const m of matches) {
          out.push(m.html);
        }
      }
    }
    // Append any videos whose index exceeded the paragraph count
    const unplaced = paragraph.filter((p) => p.afterIndex > pSeen);
    for (const u of unplaced) {
      out.push(u.html);
    }
    result = out.join("");
  }

  // Prepend before-content, append after-content
  if (before.length > 0) {
    result = before.join("") + result;
  }
  if (after.length > 0) {
    result = result + after.join("");
  }

  return result;
}
