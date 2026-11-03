// What a failed request means in plain words. OpenRouter's errors arrive as
// a status and a JSON body; the user needs to know what to do about it, and
// when a new key is the fix the chat offers the way to one.
export type Explanation = {
  readonly message: string;
  readonly recover?: "key";
};

const explanations: readonly (readonly [RegExp, Explanation])[] = [
  [
    /no openrouter api key was given/i,
    {
      message: "The agent needs an OpenRouter key before it can reply.",
      recover: "key",
    },
  ],
  [
    /\b401\b|unauthori[sz]ed|no auth credentials|invalid api key|user not found/i,
    {
      message: "OpenRouter rejected the key. Check it and try again.",
      recover: "key",
    },
  ],
  [
    /\b402\b|insufficient credits|more credits/i,
    {
      message: "The OpenRouter key has no credits left for this model.",
      recover: "key",
    },
  ],
  [
    /\b429\b|rate limit/i,
    { message: "OpenRouter is busy. Wait a moment and try again." },
  ],
  [
    /\b50\d\b|overloaded|internal server error/i,
    { message: "OpenRouter had a problem. Try again in a moment." },
  ],
  [
    /failed to fetch|networkerror|load failed|network request failed|econnrefused/i,
    {
      message:
        "Could not reach OpenRouter. Check the connection and try again.",
    },
  ],
];

export const explainError = (raw: string): Explanation => {
  for (const [pattern, explanation] of explanations) {
    if (pattern.test(raw)) return explanation;
  }
  return { message: raw };
};
