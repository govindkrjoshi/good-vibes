// Reads the OpenRouter key for a request. The browser has no environment to
// resolve a key from, so the agent is handed one of these and calls it on
// every request, letting the user change the key mid-conversation.
export type ApiKey = () => string;
