import { NextRequest, NextResponse } from "next/server";

/**
 * Generates a local HTML preview of a site based on wizard form data.
 * This lets users preview how their site will look without needing
 * a real Cloudflare Pages deployment.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    siteName: string;
    siteTagline: string;
    domain: string;
    themeBase: string;
    audience: string;
    tone: string;
    topics: string[];
    contentGuidelines: string;
  };

  const themeStyles: Record<string, { primary: string; accent: string; bg: string; fontHeading: string; fontBody: string; radius: string }> = {
    modern:    { primary: "#0066FF", accent: "#00CCFF", bg: "#ffffff", fontHeading: "Inter, system-ui, sans-serif", fontBody: "Inter, system-ui, sans-serif", radius: "12px" },
    editorial: { primary: "#1a1a2e", accent: "#e94560", bg: "#faf9f6", fontHeading: "Playfair Display, Georgia, serif", fontBody: "Lora, Georgia, serif", radius: "4px" },
    bold:      { primary: "#0d9488", accent: "#14b8a6", bg: "#0f172a", fontHeading: "Inter, system-ui, sans-serif", fontBody: "Inter, system-ui, sans-serif", radius: "8px" },
    classic:   { primary: "#4338ca", accent: "#7c3aed", bg: "#fffbf5", fontHeading: "Playfair Display, Georgia, serif", fontBody: "Lora, Georgia, serif", radius: "2px" },
  };

  const style = themeStyles[body.themeBase] ?? themeStyles.modern!;
  const primaryColor = style.primary;
  const accentColor = style.accent;
  const bgColor = style.bg;
  const fontHeading = style.fontHeading;
  const fontBody = style.fontBody;

  // Generate sample articles from topics
  const sampleArticles = body.topics.slice(0, 6).map((topic, i) => ({
    title: generateArticleTitle(topic, i),
    excerpt: `Discover the latest insights about ${topic.toLowerCase()}. Our comprehensive coverage brings you everything you need to know.`,
    category: topic,
    date: formatDate(i),
  }));

  // If not enough topics, add generic ones
  while (sampleArticles.length < 4) {
    sampleArticles.push({
      title: `What You Need to Know in ${new Date().getFullYear()}`,
      excerpt: "Stay informed with our latest coverage and expert analysis on trending topics.",
      category: "Featured",
      date: formatDate(sampleArticles.length),
    });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(body.siteName)} — Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@400;600;700&family=Lora:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ${fontBody};
      background: ${bgColor};
      color: #333;
      line-height: 1.6;
    }
    .preview-banner {
      background: linear-gradient(90deg, #52BAF2, #C542C5);
      color: white;
      text-align: center;
      padding: 6px 16px;
      font-size: 12px;
      font-family: Inter, system-ui, sans-serif;
      letter-spacing: 0.5px;
    }
    header {
      background: ${primaryColor};
      color: white;
      padding: 0;
    }
    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      font-family: ${fontHeading};
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .tagline {
      font-size: 13px;
      opacity: 0.8;
      margin-top: 2px;
    }
    nav {
      display: flex;
      gap: 24px;
    }
    nav a {
      color: rgba(255,255,255,0.85);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: color 0.2s;
    }
    nav a:hover { color: white; }
    .hero {
      background: linear-gradient(135deg, ${primaryColor}, ${accentColor});
      color: white;
      padding: 60px 24px;
      text-align: center;
    }
    .hero h1 {
      font-family: ${fontHeading};
      font-size: 42px;
      font-weight: 700;
      margin-bottom: 16px;
      line-height: 1.2;
    }
    .hero p {
      font-size: 18px;
      opacity: 0.9;
      max-width: 600px;
      margin: 0 auto;
    }
    .content { max-width: 1200px; margin: 0 auto; padding: 40px 24px; }
    .section-title {
      font-family: ${fontHeading};
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 24px;
      color: ${primaryColor};
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 24px;
    }
    .card {
      background: white;
      border-radius: ${style.radius};
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .card-img {
      height: 180px;
      background: linear-gradient(135deg, ${primaryColor}22, ${accentColor}33);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card-img svg { width: 48px; height: 48px; opacity: 0.3; }
    .card-body { padding: 20px; }
    .card-category {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: ${accentColor};
      margin-bottom: 8px;
    }
    .card-title {
      font-family: ${fontHeading};
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #1a1a1a;
      line-height: 1.3;
    }
    .card-excerpt {
      font-size: 14px;
      color: #666;
      line-height: 1.5;
    }
    .card-meta {
      margin-top: 12px;
      font-size: 12px;
      color: #999;
    }
    .sidebar-section {
      background: white;
      border-radius: ${style.radius};
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 24px;
    }
    .sidebar-title {
      font-family: ${fontHeading};
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #1a1a1a;
    }
    .topic-tag {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      margin: 4px;
      background: ${primaryColor}10;
      color: ${primaryColor};
      border: 1px solid ${primaryColor}25;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: 32px;
      align-items: start;
    }
    footer {
      background: #1a1a1a;
      color: rgba(255,255,255,0.6);
      padding: 40px 24px;
      margin-top: 60px;
    }
    .footer-inner {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .footer-brand {
      font-family: ${fontHeading};
      font-size: 20px;
      font-weight: 700;
      color: white;
    }
    @media (max-width: 768px) {
      .two-col { grid-template-columns: 1fr; }
      .hero h1 { font-size: 28px; }
      nav { display: none; }
    }
  </style>
</head>
<body>
  <div class="preview-banner">
    PREVIEW MODE — ${escapeHtml(body.domain)}
  </div>

  <header>
    <div class="header-inner">
      <div>
        <div class="logo">${escapeHtml(body.siteName)}</div>
        ${body.siteTagline ? `<div class="tagline">${escapeHtml(body.siteTagline)}</div>` : ""}
      </div>
      <nav>
        ${body.topics.slice(0, 4).map((t) => `<a href="#">${escapeHtml(t)}</a>`).join("\n        ")}
        <a href="#">About</a>
      </nav>
    </div>
  </header>

  <div class="hero">
    <h1>${escapeHtml(body.siteName)}</h1>
    <p>${body.audience ? escapeHtml(`Content for ${body.audience.toLowerCase()}`) : escapeHtml(body.siteTagline || `Welcome to ${body.siteName}`)}</p>
  </div>

  <div class="content">
    <div class="two-col">
      <div>
        <h2 class="section-title">Latest Articles</h2>
        <div class="grid">
          ${sampleArticles.map((a) => `
          <article class="card">
            <div class="card-img">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="m21 15-5-5L5 21"/>
              </svg>
            </div>
            <div class="card-body">
              <div class="card-category">${escapeHtml(a.category)}</div>
              <h3 class="card-title">${escapeHtml(a.title)}</h3>
              <p class="card-excerpt">${escapeHtml(a.excerpt)}</p>
              <div class="card-meta">${escapeHtml(a.date)}</div>
            </div>
          </article>`).join("")}
        </div>
      </div>

      <aside>
        <div class="sidebar-section">
          <h3 class="sidebar-title">Topics</h3>
          <div>
            ${body.topics.map((t) => `<span class="topic-tag">${escapeHtml(t)}</span>`).join("\n            ")}
          </div>
        </div>
        <div class="sidebar-section">
          <h3 class="sidebar-title">About</h3>
          <p style="font-size:14px;color:#666;line-height:1.6;">
            ${escapeHtml(body.audience || `${body.siteName} brings you the latest content and insights.`)}
          </p>
        </div>
        ${body.tone ? `
        <div class="sidebar-section">
          <h3 class="sidebar-title">Our Voice</h3>
          <p style="font-size:14px;color:#666;line-height:1.6;">
            ${escapeHtml(body.tone)}
          </p>
        </div>` : ""}
      </aside>
    </div>
  </div>

  <footer>
    <div class="footer-inner">
      <div class="footer-brand">${escapeHtml(body.siteName)}</div>
      <div style="font-size:13px;">&copy; ${new Date().getFullYear()} ${escapeHtml(body.siteName)}. All rights reserved.</div>
    </div>
  </footer>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateArticleTitle(topic: string, index: number): string {
  const templates = [
    `The Ultimate Guide to ${topic} in ${new Date().getFullYear()}`,
    `Top 10 ${topic} Trends You Can't Ignore`,
    `How ${topic} Is Changing Everything We Know`,
    `${topic}: What Experts Are Saying Now`,
    `Why ${topic} Matters More Than Ever`,
    `Breaking Down the Latest ${topic} Developments`,
  ];
  return templates[index % templates.length]!;
}

function formatDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
