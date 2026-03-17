const express = require('express');
const http = require('http');
const path = require('path');
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

function createPty() {
  return pty.spawn(getShellCommand(), [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });
}

wss.on('connection', (ws) => {
  const term = createPty();

  const sendText = (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  };

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

    term.write(input);
  });

  ws.on('close', () => {
    term.kill();
  });

  ws.on('error', () => {
    term.kill();
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
