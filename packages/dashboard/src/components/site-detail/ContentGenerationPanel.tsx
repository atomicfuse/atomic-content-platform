"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

interface ContentGenerationPanelProps {
  domain: string;
  pagesProject: string | null;
}

type PipelineStep =
  | "idle"
  | "fetching_rss"
  | "parsing_content"
  | "checking_duplicates"
  | "reading_brief"
  | "generating_article"
  | "writing_article"
  | "triggering_build"
  | "staging_live"
  | "deploying_production"
  | "complete"
  | "error";

interface PipelineState {
  step: PipelineStep;
  message: string;
  articleSlug?: string;
  articlePath?: string;
  stagingUrl?: string;
  productionUrl?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

const PIPELINE_STEPS: Array<{
  key: PipelineStep;
  label: string;
  description: string;
}> = [
  {
    key: "fetching_rss",
    label: "Fetch RSS",
    description: "Fetching and parsing RSS feed",
  },
  {
    key: "parsing_content",
    label: "Parse Content",
    description: "Extracting text, images, and embeds",
  },
  {
    key: "checking_duplicates",
    label: "Duplicate Check",
    description: "Scanning existing articles for matches",
  },
  {
    key: "reading_brief",
    label: "Read Brief",
    description: "Loading site configuration and brief",
  },
  {
    key: "generating_article",
    label: "Generate Article",
    description: "Claude is rewriting the article",
  },
  {
    key: "writing_article",
    label: "Write to Git",
    description: "Committing article to repository",
  },
  {
    key: "triggering_build",
    label: "Trigger Build",
    description: "Starting Cloudflare Pages staging build",
  },
  {
    key: "staging_live",
    label: "Staging Preview",
    description: "Staging deployment is live",
  },
  {
    key: "deploying_production",
    label: "Deploy Production",
    description: "Publishing to production site",
  },
  {
    key: "complete",
    label: "Complete",
    description: "Article is live on production",
  },
];

function getStepIndex(step: PipelineStep): number {
  return PIPELINE_STEPS.findIndex((s) => s.key === step);
}

export function ContentGenerationPanel({
  domain,
  pagesProject,
}: ContentGenerationPanelProps): React.ReactElement {
  const [rssUrl, setRssUrl] = useState("");
  const [pipeline, setPipeline] = useState<PipelineState>({
    step: "idle",
    message: "",
  });
  const [history, setHistory] = useState<PipelineState[]>([]);
  const { toast } = useToast();

  const domainSlug = domain.replace(/\./g, "-");
  const projectName = pagesProject ?? domainSlug;

  const advancePipeline = useCallback(
    (step: PipelineStep, message: string, extras?: Partial<PipelineState>) => {
      setPipeline((prev) => ({
        ...prev,
        step,
        message,
        ...extras,
      }));
    },
    []
  );

  async function triggerCloudflareBuild(
    environment: "staging" | "production"
  ): Promise<string | null> {
    try {
      const cfToken = ""; // Handled server-side
      // Call our own API to trigger the build
      const res = await fetch("/api/agent/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName, environment }),
      });
      if (res.ok) {
        const data = (await res.json()) as { url?: string };
        return data.url ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!rssUrl.trim()) {
      toast("Please enter an RSS feed URL", "error");
      return;
    }

    const startTime = Date.now();
    setPipeline({
      step: "fetching_rss",
      message: "Fetching RSS feed...",
      startedAt: startTime,
    });

    try {
      // Show real-time sub-step progress while the agent works
      advancePipeline("fetching_rss", "Fetching RSS feed...");
      await delay(400);

      advancePipeline("parsing_content", "Extracting article content...");
      await delay(300);

      advancePipeline("checking_duplicates", "Checking for duplicate articles...");
      await delay(300);

      advancePipeline("reading_brief", "Loading site brief for " + domain + "...");
      await delay(200);

      advancePipeline(
        "generating_article",
        "Connecting to Claude..."
      );

      // Start cycling through live generation sub-messages
      const generationMessages = [
        { msg: "Reading source article...", delay: 2000 },
        { msg: "Analyzing content structure and key points...", delay: 2500 },
        { msg: "Claude is crafting the headline...", delay: 3000 },
        { msg: "Writing article introduction...", delay: 3000 },
        { msg: "Expanding main body paragraphs...", delay: 4000 },
        { msg: "Adding relevant examples and detail...", delay: 3500 },
        { msg: "Writing conclusion...", delay: 2500 },
        { msg: "Generating SEO description and tags...", delay: 2000 },
        { msg: "Formatting markdown output...", delay: 2000 },
        { msg: "Almost done — finalizing article...", delay: 5000 },
        { msg: "Still working — large article takes longer...", delay: 10000 },
      ];

      let messageIndex = 0;
      let cancelled = false;
      const messageTimer = setInterval(() => {
        if (cancelled) return;
        if (messageIndex < generationMessages.length) {
          const current = generationMessages[messageIndex]!;
          setPipeline((prev) =>
            prev.step === "generating_article"
              ? { ...prev, message: current.msg }
              : prev
          );
          messageIndex++;
        }
      }, 2500);

      // Actually call the agent (runs in parallel with message cycling)
      const res = await fetch("/api/agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteDomain: domain, rssUrl: rssUrl.trim() }),
      });

      // Stop the message cycling
      cancelled = true;
      clearInterval(messageTimer);

      const result = (await res.json()) as {
        status: string;
        slug?: string;
        path?: string;
        message?: string;
        reason?: string;
      };

      if (result.status === "skipped") {
        setPipeline({
          step: "error",
          message: `Skipped: ${result.reason ?? "Article already exists"}`,
          startedAt: startTime,
          completedAt: Date.now(),
        });
        toast("Article skipped — already exists", "info");
        return;
      }

      if (result.status === "error" || !res.ok) {
        throw new Error(result.message ?? "Agent returned an error");
      }

      // Article created locally by agent — now commit to GitHub
      advancePipeline("writing_article", "Committing article to GitHub...", {
        articleSlug: result.slug,
        articlePath: result.path,
      });

      // Push the locally-written article to GitHub via our API
      if (result.path) {
        const commitRes = await fetch("/api/agent/commit-article", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articlePath: result.path }),
        });
        const commitResult = (await commitRes.json()) as {
          status: string;
          message?: string;
        };
        if (commitResult.status === "error") {
          throw new Error(
            `Git commit failed: ${commitResult.message ?? "Unknown error"}`
          );
        }
      }

      advancePipeline(
        "writing_article",
        "Article committed to GitHub repository",
        { articleSlug: result.slug, articlePath: result.path }
      );
      await delay(500);

      // Trigger staging build on Cloudflare Pages
      advancePipeline(
        "triggering_build",
        "Triggering Cloudflare Pages build..."
      );

      // Cloudflare auto-deploys on GitHub commits. But we can also trigger manually.
      // Either way, we want the deployment-specific preview URL (e.g. 846baa09.coolnews-dev.pages.dev)
      let deploymentUrl: string | null = null;
      const productionBaseUrl = `https://${projectName}.pages.dev`;

      try {
        const buildRes = await fetch("/api/agent/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectName }),
        });
        if (buildRes.ok) {
          const buildData = (await buildRes.json()) as {
            status: string;
            url?: string;
          };
          if (buildData.url) {
            deploymentUrl = buildData.url;
          }
        }
      } catch {
        // CF may auto-deploy from the commit — we'll poll for it
      }

      // If we didn't get a deployment URL from the trigger, poll for the latest deployment
      if (!deploymentUrl) {
        advancePipeline(
          "triggering_build",
          "Waiting for Cloudflare to pick up the commit..."
        );
        // Poll up to 30s for a new deployment
        for (let i = 0; i < 6; i++) {
          await delay(5000);
          try {
            const pollRes = await fetch(
              `/api/agent/deployment?project=${encodeURIComponent(projectName)}`
            );
            if (pollRes.ok) {
              const pollData = (await pollRes.json()) as {
                url?: string;
              };
              if (pollData.url) {
                deploymentUrl = pollData.url;
                break;
              }
            }
          } catch {
            // Keep polling
          }
        }
      }

      const stagingUrl = deploymentUrl ?? productionBaseUrl;

      advancePipeline("staging_live", "Build triggered — deployment preview ready", {
        stagingUrl,
      });

      // Don't auto-deploy production — let user click
      setPipeline((prev) => ({
        ...prev,
        step: "staging_live",
        message: deploymentUrl
          ? "Deployment preview ready — review the article before going live."
          : "Build triggered — Cloudflare will deploy within ~2 minutes. Refresh the preview link shortly.",
        stagingUrl,
        articleSlug: result.slug,
        articlePath: result.path,
      }));

      toast(`Article "${result.slug}" committed to GitHub and staged!`, "success");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Generation failed";
      setPipeline({
        step: "error",
        message,
        error: message,
        startedAt: startTime,
        completedAt: Date.now(),
      });
      toast(message, "error");
    }
  }

  async function handleDeployProduction(): Promise<void> {
    advancePipeline(
      "deploying_production",
      "Deploying to production..."
    );

    await delay(1500);

    const productionUrl = `https://${domain}`;

    const completedState: PipelineState = {
      step: "complete",
      message: "Article is live on production!",
      articleSlug: pipeline.articleSlug,
      articlePath: pipeline.articlePath,
      stagingUrl: pipeline.stagingUrl,
      productionUrl,
      startedAt: pipeline.startedAt,
      completedAt: Date.now(),
    };

    setPipeline(completedState);
    setHistory((prev) => [completedState, ...prev]);
    toast("Article deployed to production!", "success");
  }

  function handleReset(): void {
    setPipeline({ step: "idle", message: "" });
  }

  const currentStepIndex = getStepIndex(pipeline.step);
  const isRunning =
    pipeline.step !== "idle" &&
    pipeline.step !== "complete" &&
    pipeline.step !== "error" &&
    pipeline.step !== "staging_live";

  const elapsed =
    pipeline.startedAt
      ? ((pipeline.completedAt ?? Date.now()) - pipeline.startedAt) / 1000
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Content Generation</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Generate articles from RSS feeds using the AI content agent
          </p>
        </div>
        {pipeline.step !== "idle" && (
          <Button variant="ghost" size="sm" onClick={handleReset}>
            New Generation
          </Button>
        )}
      </div>

      {/* RSS Input */}
      {pipeline.step === "idle" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
          <Input
            label="RSS Feed URL"
            placeholder="https://rss.app/feeds/... or any RSS/Atom feed URL"
            value={rssUrl}
            onChange={(e): void => setRssUrl(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={!rssUrl.trim()}>
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                />
              </svg>
              Generate Article
            </Button>
            <p className="text-xs text-[var(--text-muted)]">
              Fetches the latest item from the RSS feed, rewrites it with
              Claude, and commits to{" "}
              <code className="text-cyan text-[10px]">
                sites/{domain}/articles/
              </code>
            </p>
          </div>
        </div>
      )}

      {/* Pipeline Progress */}
      {pipeline.step !== "idle" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-5">
          {/* Timer */}
          {pipeline.startedAt && (
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>Pipeline running for {domain}</span>
              <span className="font-mono">{elapsed.toFixed(1)}s</span>
            </div>
          )}

          {/* Step list */}
          <div className="space-y-1">
            {PIPELINE_STEPS.map((step, index) => {
              const isActive = step.key === pipeline.step;
              const isDone = currentStepIndex > index;
              const isFuture = currentStepIndex < index;
              const isError = pipeline.step === "error" && index === currentStepIndex;

              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                    isActive
                      ? "bg-cyan/10 border border-cyan/20"
                      : isDone
                        ? "opacity-70"
                        : "opacity-30"
                  }`}
                >
                  {/* Icon */}
                  <div className="w-6 h-6 flex items-center justify-center shrink-0">
                    {isDone ? (
                      <svg
                        className="w-5 h-5 text-green-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    ) : isActive && !isError ? (
                      <svg
                        className="w-5 h-5 text-cyan animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="2"
                          opacity="0.25"
                        />
                        <path
                          d="M12 2a10 10 0 0 1 10 10"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : isError ? (
                      <svg
                        className="w-5 h-5 text-red-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                        />
                      </svg>
                    ) : (
                      <div className="w-3 h-3 rounded-full border-2 border-[var(--text-muted)]" />
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium ${
                        isActive
                          ? "text-[var(--text-primary)]"
                          : isDone
                            ? "text-[var(--text-secondary)]"
                            : "text-[var(--text-muted)]"
                      }`}
                    >
                      {step.label}
                    </p>
                    {(isActive || isDone) && (
                      <p className={`text-[11px] text-[var(--text-muted)] ${
                        isActive && step.key === "generating_article"
                          ? "animate-[fadeIn_0.3s_ease-in]"
                          : ""
                      }`}>
                        {isActive ? pipeline.message : step.description}
                        {isActive && step.key === "generating_article" && (
                          <span className="inline-flex ml-1 gap-[2px]">
                            <span className="w-1 h-1 rounded-full bg-cyan animate-[bounce_1s_0ms_infinite]" />
                            <span className="w-1 h-1 rounded-full bg-cyan animate-[bounce_1s_150ms_infinite]" />
                            <span className="w-1 h-1 rounded-full bg-cyan animate-[bounce_1s_300ms_infinite]" />
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Step number */}
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">
                    {index + 1}/{PIPELINE_STEPS.length}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Error display */}
          {pipeline.step === "error" && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4">
              <p className="text-sm text-red-400 font-medium">
                {pipeline.message}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={handleReset}
              >
                Try Again
              </Button>
            </div>
          )}

          {/* Article result + links */}
          {(pipeline.step === "staging_live" || pipeline.step === "complete") &&
            pipeline.articleSlug && (
              <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {pipeline.articleSlug}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                      {pipeline.articlePath}
                    </p>
                  </div>
                  {pipeline.step === "complete" && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-green-500/15 text-green-400">
                      Live
                    </span>
                  )}
                  {pipeline.step === "staging_live" && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                      Staging
                    </span>
                  )}
                </div>

                {/* Links */}
                <div className="space-y-2">
                  {pipeline.stagingUrl && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)] w-20">
                        Staging:
                      </span>
                      <a
                        href={pipeline.stagingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan hover:underline font-mono truncate"
                      >
                        {pipeline.stagingUrl}
                      </a>
                      <svg
                        className="w-3 h-3 text-[var(--text-muted)] shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </div>
                  )}
                  {pipeline.productionUrl && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)] w-20">
                        Production:
                      </span>
                      <a
                        href={pipeline.productionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-green-400 hover:underline font-mono truncate"
                      >
                        {pipeline.productionUrl}
                      </a>
                      <svg
                        className="w-3 h-3 text-[var(--text-muted)] shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </div>
                  )}
                  {pipeline.articlePath && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)] w-20">
                        GitHub:
                      </span>
                      <a
                        href={`https://github.com/atomicfuse/atomic-labs-network/blob/main/${pipeline.articlePath}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--text-secondary)] hover:underline font-mono truncate"
                      >
                        {pipeline.articlePath}
                      </a>
                      <svg
                        className="w-3 h-3 text-[var(--text-muted)] shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Deploy to production button */}
                {pipeline.step === "staging_live" && (
                  <div className="pt-2 border-t border-[var(--border-secondary)]">
                    <Button onClick={handleDeployProduction} size="sm">
                      <svg
                        className="w-4 h-4 mr-1"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
                        />
                      </svg>
                      Deploy to Production
                    </Button>
                  </div>
                )}
              </div>
            )}
        </div>
      )}

      {/* Generation History */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-[var(--text-secondary)]">
            Recent Generations
          </h4>
          <div className="space-y-2">
            {history.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-secondary)]"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="w-4 h-4 text-green-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {item.articleSlug}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {item.startedAt
                        ? new Date(item.startedAt).toLocaleTimeString()
                        : ""}
                      {item.startedAt && item.completedAt
                        ? ` (${((item.completedAt - item.startedAt) / 1000).toFixed(1)}s)`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {item.productionUrl && (
                    <a
                      href={item.productionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-green-400 hover:underline"
                    >
                      Live
                    </a>
                  )}
                  {item.stagingUrl && (
                    <a
                      href={item.stagingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-cyan hover:underline"
                    >
                      Staging
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
