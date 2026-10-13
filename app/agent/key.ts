// Vite replaces this with OPENROUTER_API_KEY from the dev server's environment.
// Production builds get an empty string, so no key is ever baked into them.
declare const __DEV_OPENROUTER_API_KEY__: string;

export const apiKeyStorageKey = "good-vibes:openrouter-api-key";

const present = (key: string | null | undefined) => {
  const trimmed = key?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

export const devApiKey = (): string | undefined =>
  import.meta.env.DEV ? present(__DEV_OPENROUTER_API_KEY__) : undefined;

// Storage can be missing or throw (private windows, blocked site data), which
// only means the user is asked again.
export const storedApiKey = (): string | undefined => {
  try {
    return present(localStorage.getItem(apiKeyStorageKey));
  } catch {
    return undefined;
  }
};

export const storeApiKey = (key: string) => {
  try {
    localStorage.setItem(apiKeyStorageKey, key);
  } catch {
    // Kept for this page load only; see storedApiKey.
  }
};

// The dev environment first, then what the user saved earlier.
export const knownApiKey = (): string | undefined =>
  devApiKey() ?? storedApiKey();
