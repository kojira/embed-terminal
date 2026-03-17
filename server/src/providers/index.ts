import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import type { AIProvider } from "./types.js";

export function getProvider(): AIProvider {
  const providerName = (process.env.AI_PROVIDER ?? "claude").toLowerCase();

  if (providerName === "claude") {
    return new ClaudeProvider();
  }

  if (providerName === "codex") {
    return new CodexProvider();
  }

  throw new Error(`Unsupported AI_PROVIDER "${providerName}". Use "claude" or "codex".`);
}

export type { AIProvider, Message } from "./types.js";
