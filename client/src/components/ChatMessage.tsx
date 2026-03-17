type ChatMessageProps = {
  role: "user" | "assistant";
  content: string;
};

function renderTextBlock(text: string, key: string) {
  return (
    <p key={key} className="message-paragraph">
      {text.split("\n").map((line, index, lines) => (
        <span key={`${key}-${index}`}>
          {line}
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  );
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  const sections = content.split(/```/g);

  return (
    <article className={`chat-message ${role === "user" ? "chat-message-user" : "chat-message-assistant"}`}>
      <div className="chat-message-label">{role === "user" ? "You" : "AI"}</div>
      <div className="chat-message-bubble">
        {sections.map((section, index) =>
          index % 2 === 1 ? (
            <pre key={`code-${index}`} className="message-code-block">
              <code>{section.trim()}</code>
            </pre>
          ) : (
            renderTextBlock(section, `text-${index}`)
          ),
        )}
      </div>
    </article>
  );
}
