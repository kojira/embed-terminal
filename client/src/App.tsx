import { FormEvent, useEffect, useRef, useState } from "react";
import { ChatMessage } from "./components/ChatMessage";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ServerEvent =
  | { type: "session"; sessionId: string; provider?: string }
  | { type: "text"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: createId(),
      role: "assistant",
      content: "CLI-backed chat is ready. Ask something and the server will stream a response from Claude or Codex.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [providerName, setProviderName] = useState("claude");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || isLoading) {
      return;
    }

    setError(null);
    setIsLoading(true);

    const userMessage: Message = { id: createId(), role: "user", content: trimmed };
    const assistantId = createId();

    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          sessionId,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          const line = rawEvent
            .split("\n")
            .find((entry) => entry.startsWith("data: "));

          if (!line) {
            continue;
          }

          const payload = JSON.parse(line.slice(6)) as ServerEvent;

          if (payload.type === "session") {
            setSessionId(payload.sessionId);
            if (payload.provider) {
              setProviderName(payload.provider);
            }
            continue;
          }

          if (payload.type === "text") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${payload.content}` }
                  : message,
              ),
            );
            continue;
          }

          if (payload.type === "error") {
            setError(payload.message);
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: payload.message }
                  : message,
              ),
            );
            setIsLoading(false);
            return;
          }

          if (payload.type === "done") {
            setIsLoading(false);
          }
        }
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unexpected network error.";
      setError(message);
      setMessages((current) =>
        current.map((entry) =>
          entry.id === assistantId
            ? { ...entry, content: message }
            : entry,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">CLI Chat PoC</p>
            <h1>Terminal subscription chat, streamed into the browser.</h1>
          </div>
          <div className="status-pill">
            <span className="status-dot" />
            Provider: {providerName}
          </div>
        </header>

        <div className="messages">
          {messages.map((message) => (
            <ChatMessage key={message.id} role={message.role} content={message.content} />
          ))}

          {isLoading ? <div className="streaming-indicator">Streaming response...</div> : null}
          <div ref={bottomRef} />
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <label className="composer-label" htmlFor="chat-input">
            Message
          </label>
          <textarea
            id="chat-input"
            className="composer-input"
            placeholder="Ask Claude or Codex something..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={4}
            disabled={isLoading}
          />
          <div className="composer-footer">
            <div className="composer-meta">
              Session: {sessionId ?? "new session"}
              {error ? <span className="composer-error">{error}</span> : null}
            </div>
            <button className="send-button" type="submit" disabled={isLoading || !input.trim()}>
              {isLoading ? "Streaming..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
