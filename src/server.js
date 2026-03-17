const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const serverDeps = require('./server-deps');
const WebSocket = require('ws');

const MAX_BUFFER_LINES = 1000;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_WS_PATH = '/ws';
const publicDir = path.join(__dirname, '..', 'public');
const clientFile = path.join(__dirname, 'client.js');

function commandExists(command) {
  const result = serverDeps.spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
}

function getShellCommand(provider) {
  const normalizedProvider = String(provider || process.env.AI_PROVIDER || 'claude').toLowerCase();
  return normalizedProvider === 'codex' ? 'codex' : 'claude';
}

function createPty(command, options = {}) {
  const args = [];
  if (options.resume && command === 'claude') {
    args.push('--resume');
  }

  return serverDeps.spawnPty(command, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
  });
}

function createChatServer(httpServer, options = {}) {
  if (!httpServer || typeof httpServer.on !== 'function') {
    throw new TypeError('createChatServer requires an http.Server instance');
  }

  const provider = options.provider || process.env.AI_PROVIDER || 'claude';
  const wsPath = options.path || DEFAULT_WS_PATH;
  const sessions = new Map();
  const wss = new WebSocket.Server({ server: httpServer, path: wsPath });

  function destroySession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.destroyTimer) {
      clearTimeout(session.destroyTimer);
      session.destroyTimer = null;
    }

    if (session.ws) {
      try {
        session.ws.close();
      } catch (_error) {
        // Ignore close failures while tearing down.
      }
      session.ws = null;
    }

    if (session.term) {
      try {
        session.term.kill();
      } catch (_error) {
        // PTY may already be dead.
      }
    }

    sessions.delete(sessionId);
  }

  function scheduleDestroy(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.destroyTimer) {
      clearTimeout(session.destroyTimer);
    }

    session.destroyTimer = setTimeout(() => {
      destroySession(sessionId);
    }, SESSION_TIMEOUT_MS);
  }

  function cancelDestroy(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || !session.destroyTimer) {
      return;
    }

    clearTimeout(session.destroyTimer);
    session.destroyTimer = null;
  }

  function createSession(sessionId, sessionOptions = {}) {
    const command = getShellCommand(provider);
    if (!commandExists(command)) {
      return { error: `Command "${command}" not found. Please install it first.` };
    }

    let term;
    try {
      term = createPty(command, {
        resume: sessionOptions.resume,
        cwd: options.cwd,
        env: options.env,
      });
    } catch (error) {
      console.error(`Failed to start "${command}":`, error);
      return {
        error: `Failed to start "${command}". Make sure the command is installed and accessible.`,
      };
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

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let sessionId = url.searchParams.get('sessionId');
    let session;

    function sendText(data) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }

    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId);
      cancelDestroy(sessionId);

      if (session.ws) {
        try {
          session.ws.close();
        } catch (_error) {
          // Ignore replacement close failures.
        }
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
      const isExpired = Boolean(sessionId);
      sessionId = crypto.randomUUID();

      const result = createSession(sessionId, { resume: isExpired });
      if (result.error) {
        sendText(`\r\n${result.error}\r\n`);
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
      } catch (_error) {
        // Plain text terminal input.
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

  function close(callback) {
    for (const sessionId of sessions.keys()) {
      destroySession(sessionId);
    }

    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch (_error) {
        // Ignore termination failures during shutdown.
      }
    }

    if (typeof callback === 'function') {
      wss.close(callback);
      return;
    }

    return new Promise((resolve, reject) => {
      wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  return { wss, sessions, close };
}

function startServer(config = {}) {
  const host = config.host || '0.0.0.0';
  const port = Number(config.port) || 3456;
  const wsPath = config.path || DEFAULT_WS_PATH;
  const app = express();
  const server = http.createServer(app);
  const chat = createChatServer(server, config);

  app.get('/client.js', (_req, res) => {
    res.sendFile(clientFile);
  });
  app.use(express.static(publicDir, { index: false }));
  app.use((_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  server.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port} (ws path: ${wsPath})`);
  });

  return { app, server, ...chat };
}

module.exports = { createChatServer, startServer };

if (require.main === module) {
  startServer();
}
