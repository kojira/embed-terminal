import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { getProvider } from "../providers/index.js";
import type { Message } from "../providers/types.js";

const chat = new Hono();
const sessions = new Map<string, Message[]>();

type ChatRequest = {
  message?: string;
  sessionId?: string;
};

chat.post("/", async (c) => {
  let body: ChatRequest;

  try {
    body = await c.req.json<ChatRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: "Message is required." }, 400);
  }

  const sessionId = body.sessionId ?? uuidv4();
  const history = sessions.get(sessionId) ?? [];
  history.push({ role: "user", content: message });
  sessions.set(sessionId, history);

  const provider = getProvider();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendEvent = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      sendEvent({ type: "session", sessionId, provider: provider.name });

      void (async () => {
        try {
          const fullResponse = await provider.chat(history, (text) => {
            sendEvent({ type: "text", content: text });
          });

          history.push({ role: "assistant", content: fullResponse });
          sessions.set(sessionId, history);
          sendEvent({ type: "done" });
        } catch (error) {
          const messageText = error instanceof Error ? error.message : "Unknown provider error.";
          sendEvent({ type: "error", message: messageText });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export default chat;
