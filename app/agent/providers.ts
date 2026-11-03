// The services the agent can reach from the browser with a key the user
// brings, and the model it uses on each. Kept apart from ./agent, which
// pulls in the model runtime, so the key dialog can read it cheaply.
export type ProviderId = "openrouter" | "anthropic" | "openai";

export type Provider = {
  readonly id: ProviderId;
  readonly label: string;
  // Each model is made for coding agents and reliable tool calls, at a low
  // price: the agent reads the rack and the catalogue often and writes code
  // of its own.
  readonly modelId: string;
  readonly placeholder: string;
};

export const providers: readonly Provider[] = [
  // Reached over OpenRouter's chat-completions API: Anthropic models go
  // through its Anthropic-style endpoint, whose headers OpenRouter's CORS
  // rejects, so the browser cannot call them there. Others that fit the same
  // bill: deepseek/deepseek-v4.1-flash, openai/gpt-6-luna, qwen/qwen3-coder-next.
  {
    id: "openrouter",
    label: "OpenRouter",
    modelId: "z-ai/glm-5.3-flash",
    placeholder: "sk-or-…",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    modelId: "claude-haiku-4-5",
    placeholder: "sk-ant-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    modelId: "gpt-5.4-mini",
    placeholder: "sk-…",
  },
];

export const providerOf = (id: ProviderId): Provider =>
  providers.find((provider) => provider.id === id) ?? providers[0]!;

// Which service a key belongs to, from the prefix each one gives its keys.
// OpenAI's plain "sk-" has to come last, as the others share it.
export const detectProvider = (key: string): ProviderId | undefined => {
  const trimmed = key.trim();
  if (trimmed.startsWith("sk-or-")) return "openrouter";
  if (trimmed.startsWith("sk-ant-")) return "anthropic";
  if (trimmed.startsWith("sk-")) return "openai";
  return undefined;
};

export const isProviderId = (value: unknown): value is ProviderId =>
  providers.some((provider) => provider.id === value);

// A key and the service it is for.
export type Credential = {
  readonly provider: ProviderId;
  readonly key: string;
};
