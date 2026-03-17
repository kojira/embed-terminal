import { spawn } from "node:child_process";
import type { AIProvider, Message } from "./types.js";

function formatPrompt(messages: Message[]): string {
  return messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");
}

export class CodexProvider implements AIProvider {
  name = "codex";

  async chat(messages: Message[], onChunk: (text: string) => void): Promise<string> {
    const prompt = formatPrompt(messages);

    return await new Promise<string>((resolve, reject) => {
      const child = spawn("codex", ["exec", "--full-auto", "--json", prompt], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdoutBuffer = "";
      let stderr = "";
      let fullText = "";
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
          fail(new Error("Codex CLI not found. Install the `codex` binary and ensure it is on PATH."));
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
              item?: {
                type?: string;
                text?: string;
              };
            };

            if (
              parsed.type === "item.completed" &&
              parsed.item?.type === "agent_message" &&
              typeof parsed.item.text === "string"
            ) {
              fullText += parsed.item.text;
              onChunk(parsed.item.text);
            }
          } catch {
            stderr += `\nInvalid JSON from Codex CLI: ${trimmed}`;
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
          fail(new Error(`Codex CLI exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ""}`));
          return;
        }

        settled = true;
        resolve(fullText);
      });
    });
  }
}
