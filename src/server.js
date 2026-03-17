const express = require('express');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const WebSocket = require('ws');
const pty = require('node-pty');

const MAX_BUFFER_LINES = 1000;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const publicDir = path.join(__dirname, '..', 'public');

function commandExists(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
}

function getShellCommand(provider) {
  const normalizedProvider = (provider || process.env.AI_PROVIDER || 'claude').toLowerCase();
  return normalizedProvider === 'codex' ? 'codex' : 'claude';
}

function createPty(command, options) {
  const args = [];
  if (options && options.resume && command === 'claude') {
    args.push('--resume');
  }
  return pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });
}

function startServer(config = {}) {
  const host = config.host || '0.0.0.0';
  const port = Number(config.port) || 3456;
  const provider = config.provider || process.env.AI_PROVIDER || 'claude';

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: '/ws' });
  const sessions = new Map(); // sessionId -> { term, buffer, ws, exitPayload, destroyTimer }

  app.use(express.static(publicDir));

  function createSession(sessionId, options) {
    const command = getShellCommand(provider);
    if (!commandExists(command)) {
      return { error: `Command "${command}" not found. Please install it first.` };
    }

    let term;
    try {
      term = createPty(command, options);
    } catch (error) {
      console.error(`Failed to start "${command}":`, error);
      return { error: `Failed to start "${command}". Make sure the command is installed and accessible.` };
    }

    const session = {
      term,
      buffer: [],
      ws: null,
      exitPayload: null,
      destroyTimer: null,
    };

    term.on('error', (error) => {
      console.error(`PTY error for "${command}":`, error);
    });

    term.onData((data) => {
      session.buffer.push(data);
      while (session.buffer.length > MAX_BUFFER_LINES) {
        session.buffer.shift();
      }
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(data);
      }
    });

    term.onExit(({ exitCode }) => {
      session.exitPayload = JSON.stringify({ type: 'exit', code: exitCode });
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(session.exitPayload);
        session.ws.close();
      }
      scheduleDestroy(sessionId);
    });

    sessions.set(sessionId, session);
    return { session };
  }

  function scheduleDestroy(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (session.destroyTimer) clearTimeout(session.destroyTimer);
    session.destroyTimer = setTimeout(() => {
      if (session.term) {
        try {
          session.term.kill();
        } catch (e) {
          // already dead
        }
      }
      sessions.delete(sessionId);
      console.log(`Session ${sessionId} destroyed after timeout`);
    }, SESSION_TIMEOUT_MS);
  }

  function cancelDestroy(sessionId) {
    const session = sessions.get(sessionId);
    if (session && session.destroyTimer) {
      clearTimeout(session.destroyTimer);
      session.destroyTimer = null;
    }
  }

  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let sessionId = url.searchParams.get('sessionId');

    const sendText = (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    };

    let session;

    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId);
      cancelDestroy(sessionId);

      if (session.ws) {
        try {
          session.ws.close();
        } catch (e) {}
      }
      session.ws = ws;

      sendText(JSON.stringify({ type: 'session', sessionId }));

      if (session.exitPayload) {
        sendText(session.exitPayload);
        ws.close();
        return;
      }

      sendText(JSON.stringify({ type: 'replay-start' }));
      for (const chunk of session.buffer) {
        sendText(chunk);
      }
      sendText(JSON.stringify({ type: 'replay-end' }));
    } else {
      // If client sent a sessionId that no longer exists, it is an expired session - use --resume
      const isExpired = !!sessionId;
      sessionId = crypto.randomUUID();
      const result = createSession(sessionId, { resume: isExpired });
      if (result.error) {
        sendText('\r\n' + result.error + '\r\n');
        ws.close();
        return;
      }
      session = result.session;
      session.ws = ws;

      sendText(JSON.stringify({ type: 'session', sessionId, resumed: isExpired }));
    }

    ws.on('message', (message) => {
      const input = message.toString();

      try {
        const parsed = JSON.parse(input);
        if (parsed && parsed.type === 'resize') {
          const cols = Number(parsed.cols);
          const rows = Number(parsed.rows);
          if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
            session.term.resize(cols, rows);
          }
          return;
        }
      } catch (e) {
        // Non-JSON = terminal input
      }

      if (session.term) {
        session.term.write(input);
      }
    });

    ws.on('close', () => {
      session.ws = null;
      if (!session.exitPayload) {
        scheduleDestroy(sessionId);
      }
    });

    ws.on('error', () => {
      session.ws = null;
      if (!session.exitPayload) {
        scheduleDestroy(sessionId);
      }
    });
  });

  app.use((_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  server.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
  });

  return { app, server, wss };
}

module.exports = { startServer };

if (require.main === module) {
  startServer();
}
