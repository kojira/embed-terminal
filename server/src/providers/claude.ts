import { spawn } from "node:child_process";
import type { AIProvider, Message } from "./types.js";

function formatPrompt(messages: Message[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");
}

function extractAssistantText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as {
    message?: {
      content?: Array<{ type?: string; text?: string }>;
    };
  };

  return record.message?.content
    ?.filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("") ?? "";
}

function formatToolInput(input: unknown): string {
  if (input == null) {
    return "";
  }

  if (typeof input === "string") {
    return input;
  }

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function extractToolUseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as {
    tool?: {
      name?: string;
      input?: unknown;
    };
    name?: string;
    input?: unknown;
  };

  const toolName =
    (typeof record.tool?.name === "string" && record.tool.name) ||
    (typeof record.name === "string" && record.name) ||
    "Unknown";
  const input = record.tool?.input ?? record.input;
  const formattedInput = formatToolInput(input);

  return `\n\n🔧 Using tool: ${toolName}\n${formattedInput ? `${formattedInput}\n` : ""}`;
}

function extractToolResultText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as {
    content?: unknown;
    result?: unknown;
    tool_result?: unknown;
  };

  const content = record.content ?? record.result ?? record.tool_result;
  const formattedContent = formatToolInput(content);

  return formattedContent ? `\n📋 Tool result: ${formattedContent}\n\n` : "";
}

export class ClaudeProvider implements AIProvider {
  name = "claude";

  async chat(messages: Message[], onChunk: (text: string) => void): Promise<string> {
    const prompt = formatPrompt(messages);

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "claude",
        ["--print", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose", "-p", prompt],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdoutBuffer = "";
      let stderr = "";
      let finalText = "";
      let streamedText = "";
      let settled = false;

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      child.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          fail(new Error("Claude CLI not found. Install the `claude` binary and ensure it is on PATH."));
          return;
        }
        fail(error);
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          try {
            const parsed = JSON.parse(trimmed) as {
              type?: string;
              result?: string;
            };

            if (parsed.type === "assistant") {
              const text = extractAssistantText(parsed);
              if (text) {
                streamedText += text;
                onChunk(text);
              }
            }

            if (parsed.type === "tool_use") {
              const text = extractToolUseText(parsed);
              if (text) {
                onChunk(text);
              }
            }

            if (parsed.type === "tool_result") {
              const text = extractToolResultText(parsed);
              if (text) {
                onChunk(text);
              }
            }

            if (parsed.type === "result" && typeof parsed.result === "string") {
              finalText = parsed.result;
            }
          } catch {
            stderr += `\nInvalid JSON from Claude CLI: ${trimmed}`;
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }

        if (code !== 0) {
          fail(new Error(`Claude CLI exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ""}`));
          return;
        }

        settled = true;
        resolve(finalText || streamedText);
      });
    });
  }
}
