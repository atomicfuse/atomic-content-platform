import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const anthropicCreate = vi.fn();
const gatewayChat = vi.fn();
const openaiCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));
vi.mock("@cloudgrid-io/ai", () => ({ ai: { chat: gatewayChat } }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));

import { generateContent } from "../lib/ai.js";

const PARAMS = { systemPrompt: "sys", userPrompt: "user", maxTokens: 4096 };

function anthropicOk(text = "from-claude"): unknown {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

function openaiOk(text = "from-openai"): unknown {
  return { choices: [{ message: { content: text } }], usage: { prompt_tokens: 5, completion_tokens: 6 } };
}

describe("generateContent provider chain", () => {
  beforeEach(() => {
    anthropicCreate.mockReset();
    gatewayChat.mockReset();
    openaiCreate.mockReset();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic");
    vi.stubEnv("OPENAI_API_KEY", "test-openai");
    vi.stubEnv("CLAUDE_MODEL", "");
    vi.stubEnv("OPENAI_FALLBACK_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Anthropic directly first, pinned to claude-sonnet-5-5 with real usage", async () => {
    anthropicCreate.mockResolvedValue(anthropicOk());
    const res = await generateContent(PARAMS);
    expect(res).toMatchObject({ text: "from-claude", provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 20, estimated: false });
    expect(anthropicCreate.mock.calls[0]![0]).toMatchObject({ model: "claude-sonnet-5-5", system: "sys" });
    // Sonnet 5.5 thinks adaptively — a small cap would truncate the answer.
    expect(anthropicCreate.mock.calls[0]![0].max_tokens).toBeGreaterThanOrEqual(16000);
    expect(gatewayChat).not.toHaveBeenCalled();
  });

  it("falls back to the CloudGrid gateway when Anthropic errors", async () => {
    anthropicCreate.mockRejectedValue(new Error("overloaded"));
    gatewayChat.mockResolvedValue({ text: "from-gateway", model: "claude-sonnet" });
    const res = await generateContent(PARAMS);
    expect(res).toMatchObject({ text: "from-gateway", provider: "cloudgrid" });
    expect(res.usage.estimated).toBe(true);
  });

  it("falls back to OpenAI gpt-6-luna when both Claude routes fail", async () => {
    anthropicCreate.mockRejectedValue(new Error("overloaded"));
    gatewayChat.mockRejectedValue(new Error("gateway down"));
    openaiCreate.mockResolvedValue(openaiOk());
    const res = await generateContent(PARAMS);
    expect(res).toMatchObject({ text: "from-openai", provider: "openai", model: "gpt-6-luna" });
    expect(openaiCreate.mock.calls[0]![0]).toMatchObject({ model: "gpt-6-luna" });
  });

  it("skips Anthropic when no key is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    gatewayChat.mockResolvedValue({ text: "from-gateway", model: "claude-sonnet" });
    await generateContent(PARAMS);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("treats a refusal or truncated Claude answer as a failure", async () => {
    anthropicCreate.mockResolvedValue({ ...(anthropicOk() as object), stop_reason: "max_tokens" });
    gatewayChat.mockResolvedValue({ text: "from-gateway", model: "claude-sonnet" });
    const res = await generateContent(PARAMS);
    expect(res.provider).toBe("cloudgrid");
  });

  it("throws one error naming every provider when all fail", async () => {
    anthropicCreate.mockRejectedValue(new Error("a-down"));
    gatewayChat.mockRejectedValue(new Error("g-down"));
    openaiCreate.mockRejectedValue(new Error("o-down"));
    await expect(generateContent(PARAMS)).rejects.toThrow(/anthropic: a-down.*cloudgrid: g-down.*openai: o-down/);
  });

  it("does not stay stuck on a provider after one failure", async () => {
    anthropicCreate.mockRejectedValueOnce(new Error("blip")).mockResolvedValue(anthropicOk());
    gatewayChat.mockResolvedValue({ text: "from-gateway", model: "claude-sonnet" });
    expect((await generateContent(PARAMS)).provider).toBe("cloudgrid");
    expect((await generateContent(PARAMS)).provider).toBe("anthropic");
  });

  it("honours model overrides from env", async () => {
    vi.stubEnv("CLAUDE_MODEL", "claude-opus-5-5");
    anthropicCreate.mockResolvedValue(anthropicOk());
    expect((await generateContent(PARAMS)).model).toBe("claude-opus-5-5");
  });
});
