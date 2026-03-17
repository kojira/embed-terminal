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

export class ClaudeProvider implements AIProvider {
  name = "claude";

  async chat(messages: Message[], onChunk: (text: string) => void): Promise<string> {
    const prompt = formatPrompt(messages);

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "claude",
        ["--print", "--output-format", "stream-json", "--verbose", "-p", prompt],
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
