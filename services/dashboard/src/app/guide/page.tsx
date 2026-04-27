"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface GuideSection {
  slug: string;
  title: string;
  content: string;
}

const GUIDE_PAGES = [
  { slug: "01-overview", title: "System Overview" },
  { slug: "02-sites", title: "Managing Sites" },
  { slug: "03-shared-pages", title: "Shared Pages" },
  { slug: "04-ads-txt", title: "ads.txt Profiles" },
  { slug: "05-content-pipeline", title: "Content Pipeline" },
  { slug: "06-subscribe", title: "Email Subscribe" },
  { slug: "07-email-routing", title: "Email Routing" },
  { slug: "08-cloudgrid", title: "CloudGrid Deployment" },
  { slug: "09-scheduler", title: "Scheduler Agent" },
  { slug: "10-config-inheritance", title: "Config Inheritance & Groups" },
  { slug: "11-overrides", title: "Overrides & Config" },
  { slug: "12-site-builder", title: "Site Builder Flow" },
  { slug: "13-theme-and-layout", title: "Theme & Layout" },
];

export default function GuidePage(): React.ReactElement {
  const searchParams = useSearchParams();
  const selectedSlug = searchParams.get("page") ?? GUIDE_PAGES[0]!.slug;
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/guide/${selectedSlug}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { content?: string };
      })
      .then((data) => {
        setContent(
          typeof data.content === "string"
            ? data.content
            : "Failed to load guide content.",
        );
        setLoading(false);
      })
      .catch(() => {
        setContent("Failed to load guide content.");
        setLoading(false);
      });
  }, [selectedSlug]);

  return (
    <div className="flex gap-6 max-w-6xl">
      {/* Sidebar */}
      <nav className="w-48 flex-shrink-0 space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
          Guide
        </h2>
        {GUIDE_PAGES.map((page) => (
          <Link
            key={page.slug}
            href={`/guide?page=${page.slug}`}
            className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
              selectedSlug === page.slug
                ? "bg-cyan/10 text-cyan font-medium"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            {page.title}
          </Link>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {loading ? (
          <div className="text-[var(--text-secondary)] text-sm">Loading...</div>
        ) : (
          <div className="prose-custom">
            <MarkdownRenderer content={content} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple markdown renderer using dangerouslySetInnerHTML with basic parsing. */
function MarkdownRenderer({ content }: { content: string }): React.ReactElement {
  const html = renderMarkdown(content);
  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Basic markdown to HTML converter. Handles headings, paragraphs, code blocks, lists, bold, links, mermaid. */
function renderMarkdown(md: string): string {
  if (typeof md !== "string") return "";
  const lines = md.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = "";
  let inList = false;
  let listType: "ul" | "ol" = "ul";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        if (codeBlockLang === "mermaid") {
          result.push(`<pre class="mermaid-block"><code>${escapeHtml(codeBlockContent.join("\n"))}</code></pre>`);
        } else {
          result.push(`<pre class="code-block"><code>${escapeHtml(codeBlockContent.join("\n"))}</code></pre>`);
        }
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Close list if needed
    if (inList && !line.match(/^(\s*[-*]\s|^\s*\d+\.\s)/)) {
      result.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = inlineFormat(headingMatch[2]!);
      const id = headingMatch[2]!.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      result.push(`<h${level} id="${id}">${text}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      result.push("<hr />");
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (ulMatch) {
      if (!inList) {
        result.push("<ul>");
        inList = true;
        listType = "ul";
      }
      result.push(`<li>${inlineFormat(ulMatch[1]!)}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\s*\d+\.\s+(.+)/);
    if (olMatch) {
      if (!inList) {
        result.push("<ol>");
        inList = true;
        listType = "ol";
      }
      result.push(`<li>${inlineFormat(olMatch[1]!)}</li>`);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      continue;
    }

    // Paragraph
    result.push(`<p>${inlineFormat(line)}</p>`);
  }

  if (inList) {
    result.push(listType === "ul" ? "</ul>" : "</ol>");
  }

  return result.join("\n");
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, '<code class="inline-code">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
