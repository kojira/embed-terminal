const express = require('express');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const WebSocket = require('ws');
const pty = require('node-pty');

const HOST = '0.0.0.0';
const PORT = 3456;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const publicDir = path.join(__dirname, '..', 'public');

app.use(express.static(publicDir));

function getShellCommand() {
  const provider = (process.env.AI_PROVIDER || 'claude').toLowerCase();
  return provider === 'codex' ? 'codex' : 'claude';
}

function commandExists(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
}

function createPty() {
  return pty.spawn(getShellCommand(), [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

wss.on('connection', (ws) => {
  const sendText = (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  };

  const command = getShellCommand();
  if (!commandExists(command)) {
    sendText(`\r\nError: Command "${command}" not found. Please install it first.\r\n`);
    ws.close();
    return;
  }

  let term;
  try {
    term = createPty();
  } catch (error) {
    console.error(`Failed to start "${command}":`, error);
    sendText(`\r\nError: Failed to start "${command}". Make sure the command is installed and accessible.\r\n`);
    ws.close();
    return;
  }

  term.on('error', (error) => {
    console.error(`PTY error for "${command}":`, error);
    sendText(`\r\nError: Failed to start "${command}". Make sure the command is installed and accessible.\r\n`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  term.onData((data) => {
    sendText(data);
  });

  term.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      ws.close();
    }
  });

  ws.on('message', (message, isBinary) => {
    const input = isBinary ? message.toString() : message.toString();

    try {
      const parsed = JSON.parse(input);
      if (parsed && parsed.type === 'resize') {
        const cols = Number(parsed.cols);
        const rows = Number(parsed.rows);

        if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
          term.resize(cols, rows);
        }
        return;
      }
    } catch (error) {
      // Non-JSON messages are terminal input and should be passed through.
    }

    if (term) {
      term.write(input);
    }
  });

  ws.on('close', () => {
    if (term) {
      term.kill();
    }
  });

  ws.on('error', () => {
    if (term) {
      term.kill();
    }
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
