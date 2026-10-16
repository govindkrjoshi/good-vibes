// Freezes a value and everything it holds, so a test fails loudly if the code
// under test writes to its input instead of returning a new value. Only for
// tests: the app relies on not mutating, not on frozen objects.
export const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
};
