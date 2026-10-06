import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, type AssistantMessage } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

// Cheap and quick; the agent only greets for now. It has to be a model pi-ai
// reaches over OpenRouter's chat-completions API: Anthropic models go through
// its Anthropic-style endpoint, whose headers OpenRouter's CORS rejects, so
// the browser cannot call them.
export const goodVibesModelId = "openai/gpt-5.4-mini";

const systemPrompt = `You are the assistant inside Good Vibes, a browser-based modular \
synthesizer where people wire blocks together on a canvas to make sound. Be warm, \
brief, and plain-spoken. Reply in one or two short sentences.`;

const models = createModels();
models.setProvider(openrouterProvider());

export const goodVibesModel = () =>
  models.getModel("openrouter", goodVibesModelId);

export function createGoodVibesAgent(apiKey: string): Agent {
  const model = goodVibesModel();
  if (model === undefined) {
    throw new Error(`Unknown OpenRouter model ${goodVibesModelId}`);
  }

  // The browser has no environment to resolve a key from, so it is passed in.
  return new Agent({
    initialState: { systemPrompt, model, tools: [] },
    streamFn: models.streamSimple.bind(models),
    getApiKey: (provider) => (provider === "openrouter" ? apiKey : undefined),
  });
}

const replyText = (message: AssistantMessage) =>
  message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();

// A fresh agent per call: there is no conversation to carry over yet.
export async function runGoodVibesAgent(
  prompt: string,
  apiKey: string,
): Promise<string> {
  const agent = createGoodVibesAgent(apiKey);
  await agent.prompt(prompt);

  const last = agent.state.messages.at(-1);
  if (last?.role !== "assistant") {
    throw new Error("Agent finished without a reply");
  }
  if (last.stopReason === "error" || last.stopReason === "aborted") {
    throw new Error(last.errorMessage ?? "Agent run failed");
  }

  const reply = replyText(last);
  if (reply === "") throw new Error("Agent replied with no text");
  return reply;
}
