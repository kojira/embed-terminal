# embed-terminal

Embeddable web terminal server for any directory.

## Screenshots

### PC

![PC version](docs/screenshot-pc.png)

### Mobile

![Mobile version](docs/screenshot-mobile.png)

## Features

- **xterm.js** — full terminal emulation in the browser
- **node-pty** — real PTY backend via WebSocket
- **Session management** — automatic reconnection with output replay
- **IME support** — works with CJK input methods
- **Mobile friendly** — responsive terminal UI
- **Theme presets** — dark, light, monokai, dracula (or custom)

## Quick Start

```bash
npx embed-terminal --cwd /path/to/project
```

Opens a browser terminal at `http://0.0.0.0:3456` with the working directory set to `/path/to/project`.

## CLI Options

| Option | Default | Description |
|---|---|---|
| `--cwd <path>` | `process.cwd()` | Working directory for the terminal |
| `--port <number>` | `3456` | Server port |
| `--host <address>` | `0.0.0.0` | Server host |
| `--provider <name>` | `claude` | CLI provider (`claude` or `codex`) |

```bash
npx embed-terminal --cwd ~/projects/myapp --port 8080 --provider codex
```

## Library Usage (Server)

```js
const http = require('http');
const { createChatServer } = require('embed-terminal');

const server = http.createServer();

const chat = createChatServer(server, {
  cwd: '/path/to/project',
  provider: 'claude',
  path: '/ws',
});

server.listen(3000);

// Cleanup:
// await chat.close();
```

`createChatServer(server, options)` returns `{ wss, sessions, close }`.

## Library Usage (Client)

```html
<div id="terminal"></div>
<script src="/node_modules/embed-terminal/src/client.js"></script>
<script>
  const term = new ChatTerminal(document.getElementById('terminal'), {
    wsUrl: 'ws://localhost:3000/ws',
    fontSize: 14,
    theme: 'dark',
  });

  term.onExit = function (event) {
    console.log('exited with code', event.code);
  };
</script>
```

### Client Options

| Option | Default | Description |
|---|---|---|
| `wsUrl` | auto-detected | WebSocket URL |
| `fontSize` | `14` | Terminal font size |
| `fontFamily` | `"JetBrains Mono", monospace` | Terminal font |
| `theme` | `'default'` | Theme name or custom object |

### Client Methods

- `connect()` — connect to the server
- `dispose()` — close connection and clean up
- `fit()` — resize terminal to fit container
- `resize(cols, rows)` — set explicit terminal size
- `sendInput(text)` — send text to the PTY
- `setFontSize(size)` — change font size
- `setTheme(theme)` — change theme (name or object)
- `setInputTransformer(fn)` — transform input before sending

## Requirements

- Node.js 18+
- `claude` or `codex` CLI installed and available in `PATH`

## License

MIT
