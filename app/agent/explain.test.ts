import { expect, test } from "vitest";
import { explainError } from "./explain";

test("says what a rejected key means and offers a new one", () => {
  expect(explainError('401: {"message":"No auth credentials found"}')).toEqual({
    message: "OpenRouter rejected the key. Check it and try again.",
    recover: "key",
  });
  expect(explainError("No OpenRouter API key was given")).toMatchObject({
    recover: "key",
  });
  expect(explainError("402 Insufficient credits")).toMatchObject({
    recover: "key",
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
