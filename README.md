# cli-chat-terminal

Browser-based terminal UI for Claude and Codex CLI with no API keys required.

## Features

- Standalone CLI server with browser terminal UI
- Embeddable WebSocket/PTTY server for existing Node HTTP apps
- Embeddable browser `ChatTerminal` class with no build step required
- Supports `claude` and `codex`
- Session persistence across reconnects
- Mobile friendly

## Quick Start

```bash
npx cli-chat-terminal
```

Then open `http://0.0.0.0:3456` in your browser.

## Library Usage

### Server Integration

```js
const express = require('express');
const http = require('http');
const { createChatServer } = require('cli-chat-terminal');

const app = express();
const server = http.createServer(app);

const chat = createChatServer(server, {
  provider: 'claude',
  path: '/ws',
});

server.listen(3000);

// Later:
// await chat.close();
```

`createChatServer(server, options)` attaches the chat WebSocket server to an existing `http.Server` and returns:

- `wss`
- `sessions`
- `close()`

### Client Embedding

```html
<div id="terminal"></div>
<script src="/node_modules/cli-chat-terminal/src/client.js"></script>
<script>
  const term = new window.ChatTerminal(document.getElementById('terminal'), {
    wsUrl: 'ws://localhost:3000/ws',
    fontSize: 14
  });

  term.onExit = function (event) {
    console.log('CLI exited with code', event.code);
  };
</script>
```

If your app serves the packaged client through the `./client` export path, it will expose `window.ChatTerminal` when loaded in the browser.

## Standalone CLI

The CLI still starts the full standalone server and uses the same server/client library pieces internally.

## Options

- `--provider` (`claude` or `codex`, default: `claude`)
- `--port` (default: `3456`)
- `--host` (default: `0.0.0.0`)

## Example

```bash
npx cli-chat-terminal --provider codex --port 8080
```

## Requirements

- Node.js 18+
- `claude` or `codex` CLI installed and available in `PATH`

## How It Works

The package can either:

- start its own standalone Express and WebSocket server via the CLI
- attach chat PTY sessions to an existing `http.Server`
- embed the browser terminal into any page through `ChatTerminal`

## License

MIT
