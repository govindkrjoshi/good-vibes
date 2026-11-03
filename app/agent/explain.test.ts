import { expect, test } from "vitest";
import { explainError, noKeyGiven } from "./explain";

test("says what a rejected key means and offers a new one", () => {
  expect(explainError('401: {"message":"No auth credentials found"}')).toEqual({
    message: "OpenRouter rejected the key. Check it and try again.",
    recover: "key",
  });
  expect(explainError(noKeyGiven)).toMatchObject({ recover: "key" });
  expect(explainError("402 Insufficient credits")).toMatchObject({
    recover: "key",
  });
});

test("names the service the key is for", () => {
  expect(
    explainError(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      "anthropic",
    ),
  ).toEqual({
    message: "Anthropic rejected the key. Check it and try again.",
    recover: "key",
  });
  expect(
    explainError(
      "429 You exceeded your current quota (insufficient_quota)",
      "openai",
    ),
  ).toEqual({
    message: "The OpenAI key has no credits left for this model.",
    recover: "key",
  });
  expect(explainError("529 overloaded_error", "anthropic")).toEqual({
    message: "Anthropic had a problem. Try again in a moment.",
  });
});

test("explains the rest without a key to change", () => {
  expect(explainError("429 Too Many Requests")).toEqual({
    message: "OpenRouter is busy. Wait a moment and try again.",
  });
  expect(explainError("TypeError: Failed to fetch")).toEqual({
    message: "Could not reach OpenRouter. Check the connection and try again.",
  });
  expect(explainError("502 Bad Gateway").recover).toBeUndefined();
});

test("passes on what it does not recognise", () => {
  expect(explainError("The model said no.")).toEqual({
    message: "The model said no.",
  });
});
