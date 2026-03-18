import { Server } from "http";
import { WebSocketServer } from "ws";

export interface ChatServerOptions {
  /** Working directory for the terminal */
  cwd?: string;
  /** WebSocket path (default: "/ws") */
  path?: string;
  /** Return command and args for PTY. Defaults to $SHELL */
  getCommandAndArgs?: (searchParams: URLSearchParams) => { command: string; args?: string[] };
  /** Called after PTY is spawned */
  onSessionCreated?: (info: { pid: number; searchParams: URLSearchParams }) => void;
}

export interface ChatServer {
  wss: WebSocketServer;
  sessions: Map<string, unknown>;
  close: () => Promise<void>;
}

export function createChatServer(server: Server, options?: ChatServerOptions): ChatServer;
