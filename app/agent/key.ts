import { isProviderId, type Credential } from "./providers";

// Vite replaces this with the first of OPENROUTER_API_KEY, ANTHROPIC_API_KEY
// and OPENAI_API_KEY in the dev server's environment. Production builds get
// null, so no key is ever baked into them.
declare const __DEV_AGENT_CREDENTIAL__: Credential | null;

export const credentialStorageKey = "good-vibes:agent-credential";
// Where an OpenRouter key was kept before other services were supported.
export const legacyApiKeyStorageKey = "good-vibes:openrouter-api-key";

const present = (key: string | null | undefined) => {
  const trimmed = key?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const credentialFrom = (value: unknown): Credential | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { provider, key } = value as Record<string, unknown>;
  const trimmed = typeof key === "string" ? present(key) : undefined;
  if (!isProviderId(provider) || trimmed === undefined) return undefined;
  return { provider, key: trimmed };
};

export const devCredential = (): Credential | undefined =>
  import.meta.env.DEV ? credentialFrom(__DEV_AGENT_CREDENTIAL__) : undefined;

const parse = (raw: string | null): unknown => {
  try {
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};

// Storage can be missing or throw (private windows, blocked site data), which
// only means the user is asked again. A key saved before other services were
// supported is an OpenRouter one.
export const storedCredential = (): Credential | undefined => {
  try {
    const stored = credentialFrom(
      parse(localStorage.getItem(credentialStorageKey)),
    );
    if (stored !== undefined) return stored;
    const legacy = present(localStorage.getItem(legacyApiKeyStorageKey));
    return legacy === undefined
      ? undefined
      : { provider: "openrouter", key: legacy };
  } catch {
    return undefined;
  }
};

export const storeCredential = (credential: Credential) => {
  try {
    localStorage.setItem(credentialStorageKey, JSON.stringify(credential));
    localStorage.removeItem(legacyApiKeyStorageKey);
  } catch {
    // Kept for this page load only; see storedCredential.
  }
};

// The dev environment first, then what the user saved earlier.
export const knownCredential = (): Credential | undefined =>
  devCredential() ?? storedCredential();
