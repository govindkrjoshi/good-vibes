import { expect, test } from "vitest";
import { goodVibesModel } from "./agent";

test("uses a model the browser can reach through OpenRouter's CORS", () => {
  expect(goodVibesModel()).toMatchObject({
    provider: "openrouter",
    api: "openai-completions",
  });
});
