import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  htmlContent: string;
  enclosureUrl: string | undefined;
}

export interface ParsedContent {
  textBody: string;
  featuredImageUrl: string | null;
  inlineImages: Array<{ src: string; alt: string }>;
  youtubeEmbeds: string[];
}

/**
 * Fetch an RSS feed URL and return raw XML.
 */
export async function fetchRss(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Parse RSS XML and return the latest item.
 */
export function parseRssFeed(xml: string): RssItem {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "__cdata",
  });

  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channelRaw = (parsed["rss"] as Record<string, unknown>)?.["channel"];
  const channel: Record<string, unknown> =
    channelRaw && typeof channelRaw === "object" ? (channelRaw as Record<string, unknown>) : {};

  const rawItems = channel["item"];
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  if (items.length === 0) {
    throw new Error("RSS feed contains no items");
  }

  // First item is always latest in RSS
  const item = items[0] as Record<string, unknown>;

  const title = extractText(item["title"]);
  const link = extractText(item["link"]);
  const pubDate = extractText(item["pubDate"]) ?? "";

  // Prefer content:encoded over description
  const contentEncoded = item["content:encoded"] ?? item["encoded"];
  const htmlContent = extractText(contentEncoded) || extractText(item["description"]) || "";

  // Enclosure image
  const enclosure = item["enclosure"] as Record<string, unknown> | undefined;
  const mediaContent = item["media:content"] as Record<string, unknown> | undefined;
  const enclosureUrl =
    (enclosure?.["@_url"] as string | undefined) ??
    (mediaContent?.["@_url"] as string | undefined);

  return { title, link, pubDate, htmlContent, enclosureUrl };
}

/**
 * Parse HTML content from an RSS item.
 * Extracts featured image, inline images, YouTube embeds, and clean text.
 */
export function parseHtmlContent(html: string, enclosureUrl: string | undefined): ParsedContent {
  const root = parseHtml(html);

  // Remove script and style tags
  root.querySelectorAll("script, style").forEach((el) => el.remove());

  // Extract all images
  const allImages = root.querySelectorAll("img").map((img) => ({
    src: img.getAttribute("src") ?? "",
    alt: img.getAttribute("alt") ?? "",
  })).filter((img) => img.src);

  // Determine featuredImageUrl
  let featuredImageUrl: string | null = enclosureUrl ?? null;
  let inlineImages: Array<{ src: string; alt: string }>;

  if (enclosureUrl) {
    // All body images become inline
    inlineImages = allImages;
  } else if (allImages.length > 0) {
    // First body image becomes featured
    featuredImageUrl = allImages[0]!.src;
    inlineImages = allImages.slice(1);
  } else {
    inlineImages = [];
  }

  // Extract YouTube iframes (preserve full HTML)
  const youtubeEmbeds: string[] = [];
  root.querySelectorAll("iframe").forEach((iframe) => {
    const src = iframe.getAttribute("src") ?? "";
    if (src.includes("youtube.com/embed") || src.includes("youtu.be")) {
      youtubeEmbeds.push(iframe.outerHTML);
      iframe.remove();
    }
  });

  // Remove inline img tags from DOM (they'll be re-inserted in markdown)
  root.querySelectorAll("img").forEach((el) => el.remove());

  // Extract clean text body
  const textBody = root.text.replace(/\n{3,}/g, "\n\n").trim();

  return { textBody, featuredImageUrl, inlineImages, youtubeEmbeds };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if ("__cdata" in obj) return String(obj["__cdata"]);
    if ("#text" in obj) return String(obj["#text"]);
  }
  return "";
}
