# cli-chat-terminal

Browser-based terminal UI for Claude and Codex CLI with no API keys required.

## Features

- Browser terminal UI
- Supports `claude` and `codex`
- Session persistence across reconnects
- Mobile friendly
- No API keys needed

## Quick Start

```bash
npx cli-chat-terminal
```

Then open `http://0.0.0.0:3456` in your browser.

## Options

- `--provider` (`claude` or `codex`, default: `claude`)
- `--port` (default: `3456`)
- `--host` (default: `0.0.0.0`)

## Examples

```bash
npx cli-chat-terminal --provider codex --port 8080
```

## Requirements

- Node.js 18+
- `claude` or `codex` CLI installed and available in `PATH`

## How It Works

The package starts a local Express and WebSocket server, serves a browser-based terminal UI, and attaches that UI to the installed `claude` or `codex` CLI through a PTY session.

## License

MIT
