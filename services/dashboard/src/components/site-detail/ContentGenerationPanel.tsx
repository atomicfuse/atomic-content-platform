"use client";

import { useState, useCallback, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { publishStagingToProduction } from "@/actions/wizard";

interface ContentGenerationPanelProps {
  domain: string;
  pagesProject: string | null;
  pagesSubdomain: string | null;
  stagingBranch: string | null;
}

type PipelineStep =
  | "idle"
  | "querying_aggregator"
  | "filtering_articles"
  | "scraping_content"
  | "checking_duplicates"
  | "reading_brief"
  | "generating_article"
  | "scoring_quality"
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
  /** Batch result summary */
  batchSummary?: string;
  batchResults?: Array<{ status: string; slug?: string; path?: string; reason?: string; qualityScore?: number; articleStatus?: string }>;
}

const PIPELINE_STEPS: Array<{
  key: PipelineStep;
  label: string;
  description: string;
}> = [
  {
    key: "reading_brief",
    label: "Read Brief",
    description: "Loading site configuration and brief",
  },
  {
    key: "querying_aggregator",
    label: "Query Sources",
    description: "Querying content aggregator for source articles",
  },
  {
    key: "filtering_articles",
    label: "Filter & Deduplicate",
    description: "Filtering by relevance and removing duplicates",
  },
  {
    key: "scraping_content",
    label: "Fetch Content",
    description: "Fetching source article content",
  },
  {
    key: "generating_article",
    label: "Generate Articles",
    description: "Claude is rewriting the articles",
  },
  {
    key: "scoring_quality",
    label: "Quality Scoring",
    description: "Scoring articles against quality criteria",
  },
  {
    key: "writing_article",
    label: "Write to Staging",
    description: "Committing articles to staging branch",
  },
  {
    key: "triggering_build",
    label: "Trigger Build",
    description: "Starting Cloudflare Pages staging build",
  },
  {
    key: "staging_live",
    label: "Staging Preview",
    description: "Staging deployment is live — review before publishing",
  },
  {
    key: "deploying_production",
    label: "Deploy Production",
    description: "Publishing staged articles to production",
  },
  {
    key: "complete",
    label: "Complete",
    description: "Articles are live on production",
  },
];

function getStepIndex(step: PipelineStep, steps: typeof PIPELINE_STEPS): number {
  return steps.findIndex((s) => s.key === step);
}

const MIN_ARTICLE_COUNT = 1;
const MAX_ARTICLE_COUNT = 50;

export function ContentGenerationPanel({
  domain,
  pagesProject,
  pagesSubdomain,
  stagingBranch,
}: ContentGenerationPanelProps): React.ReactElement {
  const [articleCount, setArticleCount] = useState(3);
  const [pipeline, setPipeline] = useState<PipelineState>({
    step: "idle",
    message: "",
  });
  const [history, setHistory] = useState<PipelineState[]>([]);
  const [isPublishing, startPublish] = useTransition();
  const { toast } = useToast();

  const domainSlug = domain.replace(/\./g, "-");
  // For URL construction, prefer pages_subdomain (actual *.pages.dev prefix)
  const pagesHost = pagesSubdomain ?? pagesProject ?? domainSlug;
  // For CF API calls (build trigger, deployment polling), use pages_project
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

  async function handleGenerate(): Promise<void> {
    const count = Math.max(MIN_ARTICLE_COUNT, Math.min(MAX_ARTICLE_COUNT, articleCount));
    const startTime = Date.now();
    setPipeline({
      step: "reading_brief",
      message: `Loading site brief for ${domain}...`,
      startedAt: startTime,
    });

    try {
      advancePipeline("reading_brief", `Loading site brief for ${domain}...`);
      await delay(300);

      advancePipeline("querying_aggregator", "Querying content aggregator for source articles...");
      await delay(400);

      advancePipeline("filtering_articles", "Filtering by relevance and checking for duplicates...");
      await delay(300);

      advancePipeline("scraping_content", "Fetching source article content...");
      await delay(300);

      advancePipeline(
        "generating_article",
        `Generating ${count} article${count > 1 ? "s" : ""} with Claude...`
      );

      // Start cycling through live generation sub-messages
      const generationMessages = [
        { msg: "Reading source articles...", delay: 2000 },
        { msg: "Analyzing content structure and key points...", delay: 2500 },
        { msg: "Claude is crafting headlines...", delay: 3000 },
        { msg: "Writing article introductions...", delay: 3000 },
        { msg: "Expanding main body paragraphs...", delay: 4000 },
        { msg: "Adding relevant examples and detail...", delay: 3500 },
        { msg: "Writing conclusions...", delay: 2500 },
        { msg: "Generating SEO descriptions and tags...", delay: 2000 },
        { msg: "Formatting markdown output...", delay: 2000 },
        { msg: "Almost done — finalizing articles...", delay: 5000 },
        { msg: "Still working — processing multiple articles takes longer...", delay: 10000 },
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

      // Actually call the agent
      const res = await fetch("/api/agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteDomain: domain,
          branch: stagingBranch,
          count,
        }),
      });

      cancelled = true;
      clearInterval(messageTimer);

      // Show quality scoring step while parsing response
      advancePipeline("scoring_quality", "Scoring articles against quality criteria...");
      await delay(400);

      const result = (await res.json()) as {
        siteDomain: string;
        requested: number;
        totalSourced: number;
        duplicateCount: number;
        availableNew: number;
        results: Array<{
          status: string;
          slug?: string;
          path?: string;
          message?: string;
          reason?: string;
          qualityScore?: number;
          articleStatus?: string;
        }>;
      };

      // Guard against error responses that omit `results`
      if (!result.results) {
        throw new Error((result as unknown as { message?: string }).message ?? `Agent error (${res.status})`);
      }

      // Build batch summary
      const created = result.results.filter((r) => r.status === "created");
      const skipped = result.results.filter((r) => r.status === "skipped");
      const errors = result.results.filter((r) => r.status === "error");

      if (created.length === 0 && errors.length === 0) {
        // All skipped — build a descriptive message
        let reason: string;
        if (result.totalSourced === 0) {
          reason = "No related articles found from sources.";
        } else if (result.availableNew === 0) {
          reason = `Found ${result.totalSourced} related article${result.totalSourced > 1 ? "s" : ""} but all ${result.duplicateCount} already exist on the site.`;
        } else {
          reason = result.results[0]?.reason ?? "No new articles available";
        }
        setPipeline({
          step: "error",
          message: reason,
          startedAt: startTime,
          completedAt: Date.now(),
        });
        toast(reason, "info");
        return;
      }

      if (created.length === 0 && errors.length > 0) {
        throw new Error(errors[0]?.message ?? "All articles failed to generate");
      }

      // Build descriptive summary
      const batchSummary = buildBatchSummary(
        created.length,
        result.requested,
        result.totalSourced,
        result.duplicateCount,
        errors.length,
      );

      // Use the first created article for display
      const firstCreated = created[0];

      // Articles are always committed to the staging branch by the content-pipeline agent.
      // If the site has a staging branch, the agent writes directly to it via GitHub API.
      // If not, articles are written locally and we push them to GitHub.
      if (stagingBranch) {
        advancePipeline("writing_article", `Articles committed to staging branch (${batchSummary})`, {
          articleSlug: firstCreated?.slug,
          articlePath: firstCreated?.path,
          batchSummary,
          batchResults: result.results,
        });
      } else {
        advancePipeline("writing_article", "Committing articles to staging...", {
          articleSlug: firstCreated?.slug,
          articlePath: firstCreated?.path,
          batchSummary,
          batchResults: result.results,
        });

        // Push locally-written articles to GitHub via our API
        for (const article of created) {
          if (article.path) {
            const commitRes = await fetch("/api/agent/commit-article", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ articlePath: article.path }),
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
        }

        advancePipeline(
          "writing_article",
          `Articles committed to staging (${batchSummary})`,
          {
            articleSlug: firstCreated?.slug,
            articlePath: firstCreated?.path,
            batchSummary,
            batchResults: result.results,
          }
        );
      }
      await delay(500);

      // Trigger staging build on Cloudflare Pages
      advancePipeline(
        "triggering_build",
        "Triggering Cloudflare Pages build..."
      );

      let deploymentUrl: string | null = null;
      const branchSlug = stagingBranch ? stagingBranch.replace(/\//g, "-") : null;
      const stagingBaseUrl = branchSlug ? `https://${branchSlug}.${pagesHost}.pages.dev` : null;
      const productionBaseUrl = `https://${pagesHost}.pages.dev`;

      try {
        const buildRes = await fetch("/api/agent/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectName, stagingBranch, domain }),
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
        // CF may auto-deploy from the commit
      }

      if (!deploymentUrl) {
        advancePipeline(
          "triggering_build",
          "Waiting for Cloudflare to pick up the commit..."
        );
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

      const stagingUrl = deploymentUrl ?? stagingBaseUrl ?? productionBaseUrl;

      const stagingMessage = deploymentUrl
        ? `${batchSummary} — staged successfully. Review the preview before deploying to production.`
        : `${batchSummary} — staged successfully. Cloudflare will deploy the preview within ~2 minutes.`;

      // Check if any articles are published (high quality) — auto-deploy those to production
      const hasPublished = result.results.some(
        (r) => r.status === "created" && r.articleStatus === "published",
      );
      const hasReviewOnly = result.results.some(
        (r) => r.status === "created" && r.articleStatus === "review",
      );

      if (hasPublished) {
        // Auto-deploy to production — review articles are filtered out by the site builder
        advancePipeline("deploying_production", `${batchSummary} — deploying published articles to production...`, {
          stagingUrl,
        });

        try {
          await publishStagingToProduction(domain);

          const productionUrl = `https://${domain}`;
          const completeMessage = hasReviewOnly
            ? `${batchSummary} — published articles deployed to production. Review-status articles are available on staging.`
            : `${batchSummary} — deployed to production!`;

          const completedState: PipelineState = {
            step: "complete",
            message: completeMessage,
            articleSlug: firstCreated?.slug,
            articlePath: firstCreated?.path,
            stagingUrl,
            productionUrl,
            startedAt: startTime,
            completedAt: Date.now(),
            batchSummary,
            batchResults: result.results,
          };

          setPipeline(completedState);
          setHistory((prev) => [completedState, ...prev]);
          toast(completeMessage, "success");
        } catch (deployErr) {
          // If auto-deploy fails, fall back to staging_live so user can retry manually
          const deployMsg = deployErr instanceof Error ? deployErr.message : "Auto-deploy failed";
          console.error(`[content-gen] Auto-deploy failed: ${deployMsg}`);

          advancePipeline("staging_live", `${batchSummary} — staged successfully. Auto-deploy failed: ${deployMsg}`, {
            stagingUrl,
          });

          setPipeline((prev) => ({
            ...prev,
            step: "staging_live",
            message: `${batchSummary} — staged successfully. Auto-deploy failed: ${deployMsg}`,
            stagingUrl,
            articleSlug: firstCreated?.slug,
            articlePath: firstCreated?.path,
            batchSummary,
            batchResults: result.results,
          }));

          toast(`Staged successfully but auto-deploy failed: ${deployMsg}`, "info");
        }
      } else {
        // All articles are review-only — stay on staging for manual review
        const stagingMessage = `${batchSummary} — staged for review. Review the articles before deploying to production.`;

        advancePipeline("staging_live", stagingMessage, {
          stagingUrl,
        });

        setPipeline((prev) => ({
          ...prev,
          step: "staging_live",
          message: stagingMessage,
          stagingUrl,
          articleSlug: firstCreated?.slug,
          articlePath: firstCreated?.path,
          batchSummary,
          batchResults: result.results,
        }));

        toast(`${batchSummary} for ${domain} — review on staging`, "success");
      }
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

  function handleDeployProduction(): void {
    startPublish(async () => {
      try {
        advancePipeline(
          "deploying_production",
          "Merging staging to production..."
        );

        await publishStagingToProduction(domain);

        const productionUrl = `https://${domain}`;

        const completedState: PipelineState = {
          step: "complete",
          message: "Articles are live on production!",
          articleSlug: pipeline.articleSlug,
          articlePath: pipeline.articlePath,
          stagingUrl: pipeline.stagingUrl,
          productionUrl,
          startedAt: pipeline.startedAt,
          completedAt: Date.now(),
          batchSummary: pipeline.batchSummary,
          batchResults: pipeline.batchResults,
        };

        setPipeline(completedState);
        setHistory((prev) => [completedState, ...prev]);
        toast("Articles deployed to production!", "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Deploy failed";
        toast(message, "error");
        // Stay on staging_live so user can retry
        advancePipeline("staging_live", `Deploy failed: ${message}`);
      }
    });
  }

  function handleReset(): void {
    setPipeline({ step: "idle", message: "" });
  }

  const currentStepIndex = getStepIndex(pipeline.step, PIPELINE_STEPS);
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
            Generate articles from curated content sources using the AI content agent
          </p>
        </div>
        {pipeline.step !== "idle" && (
          <Button variant="ghost" size="sm" onClick={handleReset}>
            New Generation
          </Button>
        )}
      </div>

      {/* Generation Controls */}
      {pipeline.step === "idle" && (
        <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
          <Input
            label="Number of Articles"
            type="number"
            min={MIN_ARTICLE_COUNT}
            max={MAX_ARTICLE_COUNT}
            value={articleCount}
            onChange={(e): void => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val)) setArticleCount(Math.max(MIN_ARTICLE_COUNT, Math.min(MAX_ARTICLE_COUNT, val)));
            }}
            className="w-24"
          />
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate}>
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
              Generate {articleCount} Article{articleCount > 1 ? "s" : ""}
            </Button>
            <p className="text-xs text-[var(--text-muted)]">
              Sources articles from the content aggregator, rewrites them with
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

          {/* Batch results summary */}
          {(pipeline.step === "staging_live" || pipeline.step === "complete") &&
            pipeline.batchResults && pipeline.batchResults.length > 0 && (
              <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
                {/* Summary header */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {pipeline.batchSummary}
                    </p>
                    {pipeline.articlePath && (
                      <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                        {pipeline.articlePath}
                      </p>
                    )}
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

                {/* Individual article results */}
                <div className="space-y-1">
                  {pipeline.batchResults
                    .filter((r) => r.status === "created")
                    .map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs"
                    >
                      <svg className="w-3.5 h-3.5 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="font-mono text-[var(--text-primary)]">
                        {r.slug}
                      </span>
                      {r.qualityScore !== undefined && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          r.qualityScore >= 80 ? "text-green-400 bg-green-500/10" :
                          r.qualityScore >= 60 ? "text-yellow-400 bg-yellow-500/10" :
                          "text-red-400 bg-red-500/10"
                        }`}>
                          Score: {r.qualityScore}
                        </span>
                      )}
                      {r.articleStatus === "review" && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
                          Review
                        </span>
                      )}
                      {r.articleStatus === "published" && r.qualityScore !== undefined && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
                          Published
                        </span>
                      )}
                    </div>
                  ))}
                  {pipeline.batchResults.filter((r) => r.status === "skipped").length > 0 && (
                    <p className="text-[11px] text-[var(--text-muted)] italic mt-1">
                      {pipeline.batchResults.filter((r) => r.status === "skipped").length} source{pipeline.batchResults.filter((r) => r.status === "skipped").length > 1 ? "s" : ""} skipped ({pipeline.batchResults.filter((r) => r.status === "skipped").map((r) => r.reason ?? "unknown").join(", ")})
                    </p>
                  )}
                  {pipeline.batchResults.filter((r) => r.status === "error").length > 0 && (
                    <p className="text-[11px] text-red-400 italic mt-1">
                      {pipeline.batchResults.filter((r) => r.status === "error").length} article{pipeline.batchResults.filter((r) => r.status === "error").length > 1 ? "s" : ""} failed to generate
                    </p>
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
                        href={`https://github.com/atomicfuse/atomic-labs-network/blob/${stagingBranch ?? "main"}/${pipeline.articlePath}`}
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

                {/* Deploy to production button — always shown at staging_live */}
                {pipeline.step === "staging_live" && (
                  <div className="pt-2 border-t border-[var(--border-secondary)] space-y-2">
                    <Button onClick={handleDeployProduction} size="sm" loading={isPublishing}>
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
                    <p className="text-xs text-[var(--text-muted)]">
                      Review the staged articles before deploying. This will merge changes to production.
                    </p>
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
                      {item.batchSummary ?? item.articleSlug}
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

/**
 * Build a human-readable summary explaining what happened.
 * e.g. "Created 4 articles out of 10 requested — 7 related articles found, 3 already existed."
 */
function buildBatchSummary(
  createdCount: number,
  requested: number,
  totalSourced: number,
  duplicateCount: number,
  errorCount: number,
): string {
  const parts: string[] = [];

  if (createdCount === requested) {
    // Got everything requested
    parts.push(`Created ${createdCount} article${createdCount > 1 ? "s" : ""}`);
  } else {
    // Created fewer than requested — explain why
    parts.push(`Created ${createdCount} article${createdCount > 1 ? "s" : ""} out of ${requested} requested`);

    const reasons: string[] = [];
    if (duplicateCount > 0) {
      reasons.push(`${duplicateCount} already exist${duplicateCount === 1 ? "s" : ""} on the site`);
    }
    const availableNew = totalSourced - duplicateCount;
    if (availableNew < requested && totalSourced > 0) {
      reasons.push(`only ${totalSourced} related article${totalSourced > 1 ? "s" : ""} found`);
    }
    if (errorCount > 0) {
      reasons.push(`${errorCount} failed to generate`);
    }
    if (reasons.length > 0) {
      parts.push(` — ${reasons.join(", ")}`);
    }
  }

  return parts.join("");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
