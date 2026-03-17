export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface AIProvider {
  name: string;
  chat(messages: Message[], onChunk: (text: string) => void): Promise<string>;
}
