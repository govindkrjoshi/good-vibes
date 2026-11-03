import { providerOf, type ProviderId } from "./providers";

// What a failed request means in plain words. Each service's errors arrive
// as a status and a JSON body; the user needs to know what to do about it,
// and when a new key is the fix the chat offers the way to one.
export type Explanation = {
  readonly message: string;
  readonly recover?: "key";
};

// What the session fails a prompt with when the user gave no key.
export const noKeyGiven = "No API key was given";

const explanations = (
  name: string,
): readonly (readonly [RegExp, Explanation])[] => [
  [
    /no (openrouter )?api key was given/i,
    {
      message: "The agent needs an API key before it can reply.",
      recover: "key",
    },
  ],
  [
    /\b401\b|\b403\b|unauthori[sz]ed|no auth credentials|invalid[ _]api[ _]key|invalid x-api-key|authentication_error|permission_error|user not found/i,
    {
      message: `${name} rejected the key. Check it and try again.`,
      recover: "key",
    },
  ],
  [
    /\b402\b|insufficient credits|more credits|insufficient_quota|credit balance is too low/i,
    {
      message: `The ${name} key has no credits left for this model.`,
      recover: "key",
    },
  ],
  [
    /\b429\b|rate limit|rate_limit/i,
    { message: `${name} is busy. Wait a moment and try again.` },
  ],
  [
    /\b50\d\b|\b529\b|overloaded|internal server error|api_error/i,
    { message: `${name} had a problem. Try again in a moment.` },
  ],
  [
    /failed to fetch|networkerror|load failed|network request failed|econnrefused/i,
    {
      message: `Could not reach ${name}. Check the connection and try again.`,
    },
  ],
];

export const explainError = (
  raw: string,
  provider: ProviderId = "openrouter",
): Explanation => {
  for (const [pattern, explanation] of explanations(
    providerOf(provider).label,
  )) {
    if (pattern.test(raw)) return explanation;
  }
  return { message: raw };
};
