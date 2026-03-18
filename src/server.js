const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const serverDeps = require('./server-deps');
const WebSocket = require('ws');

const MAX_BUFFER_LINES = 1000;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_WS_PATH = '/ws';
const SESSION_STORE_PATH = '/tmp/vkoma-claude-sessions.json';
const publicDir = path.join(__dirname, '..', 'public');
const clientFile = path.join(__dirname, 'client.js');

function loadSessionStore() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_STORE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSessionStore(store) {
  fs.writeFileSync(SESSION_STORE_PATH, JSON.stringify(store, null, 2));
}

function getClaudeSessionId(projectId) {
  if (!projectId) return null;
  const store = loadSessionStore();
  return store[projectId] || null;
}

function setClaudeSessionId(projectId, claudeSessionId) {
  if (!projectId) return;
  const store = loadSessionStore();
  store[projectId] = claudeSessionId;
  saveSessionStore(store);
}

function removeClaudeSessionId(projectId) {
  if (!projectId) return;
  const store = loadSessionStore();
  delete store[projectId];
  saveSessionStore(store);
}

function detectClaudeSessionId(pid, projectId, preExistingFiles, cwd) {
  if (!pid || !projectId) return;
  const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
  const maxAttempts = 20;
  let attempts = 0;

  const check = () => {
    attempts++;

    // Fast path: check PID-based file first
    const sessionFile = path.join(sessionsDir, `${pid}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      if (data.sessionId) {
        setClaudeSessionId(projectId, data.sessionId);
        return;
      }
    } catch {}

    // Fallback: directory diff approach
    if (preExistingFiles) {
      try {
        const currentFiles = fs.readdirSync(sessionsDir);
        const newFiles = currentFiles.filter((f) => !preExistingFiles.has(f) && f.endsWith('.json'));

        let bestMatch = null;
        let bestStartedAt = null;

        for (const file of newFiles) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8'));
            if (!data.sessionId) continue;

            // Prefer matching cwd
            if (cwd && data.cwd === cwd) {
              setClaudeSessionId(projectId, data.sessionId);
              return;
            }

            // Track most recent startedAt as fallback
            if (data.startedAt && (!bestStartedAt || data.startedAt > bestStartedAt)) {
              bestStartedAt = data.startedAt;
              bestMatch = data.sessionId;
            }
          } catch {}
        }

        if (bestMatch) {
          setClaudeSessionId(projectId, bestMatch);
          return;
        }
      } catch {}
    }

    if (attempts < maxAttempts) {
      setTimeout(check, 500);
    }
  };
  setTimeout(check, 1000);
}

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
  if (options.claudeSessionId && command === 'claude') {
    args.push('--resume', options.claudeSessionId);
  }
  if (options.appendSystemPrompt && command === 'claude') {
    args.push('--append-system-prompt', options.appendSystemPrompt);
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

    const projectId = sessionOptions.projectId;
    const claudeSessionId = projectId ? getClaudeSessionId(projectId) : null;

    // Snapshot existing session files before PTY spawn for directory-diff detection
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    let preExistingFiles;
    try {
      preExistingFiles = new Set(fs.readdirSync(sessionsDir));
    } catch {
      preExistingFiles = new Set();
    }

    let term;
    try {
      term = createPty(command, {
        claudeSessionId: sessionOptions.claudeSessionId || claudeSessionId,
        appendSystemPrompt: sessionOptions.appendSystemPrompt,
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
      projectId,
    };

    term.on('error', (error) => {
      console.error(`PTY error for "${command}":`, error);
    });

    const resumeErrorPatterns = [
      'Invalid session',
      'Session not found',
      'session expired',
      'invalid session',
      'Could not resume',
      'No conversation found',
    ];

    const usedClaudeSessionId = sessionOptions.claudeSessionId || claudeSessionId;
    session._isResumeAttempt = Boolean(usedClaudeSessionId);
    session._resumeVerified = false;
    session._earlyOutput = '';

    // Set a timeout to mark resume as verified if no error is detected
    let resumeVerifyTimer = null;
    if (session._isResumeAttempt) {
      resumeVerifyTimer = setTimeout(() => {
        session._resumeVerified = true;
      }, 3000);
    }

    term.onData((data) => {
      // Detect resume failure and clear invalid session ID
      if (session._isResumeAttempt && !session._resumeVerified) {
        const text = typeof data === 'string' ? data : data.toString();
        session._earlyOutput += text;
        if (resumeErrorPatterns.some((pattern) => session._earlyOutput.includes(pattern))) {
          if (projectId) {
            removeClaudeSessionId(projectId);
          }
          if (resumeVerifyTimer) {
            clearTimeout(resumeVerifyTimer);
            resumeVerifyTimer = null;
          }
          session._resumeVerified = true;
        } else if (session._earlyOutput.length >= 2000) {
          session._resumeVerified = true;
          if (resumeVerifyTimer) {
            clearTimeout(resumeVerifyTimer);
            resumeVerifyTimer = null;
          }
        }
      }

      session.buffer.push(data);
      while (session.buffer.length > MAX_BUFFER_LINES) {
        session.buffer.shift();
      }

      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(data);
      }
    });

    term.onExit(({ exitCode }) => {
      // Clear invalid session ID on resume failure
      if (exitCode !== 0 && session._isResumeAttempt && !session._resumeVerified) {
        if (projectId) {
          removeClaudeSessionId(projectId);
        }
      }

      session.exitPayload = JSON.stringify({ type: 'exit', code: exitCode });
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(session.exitPayload);
        session.ws.close();
      }
      scheduleDestroy(sessionId);
    });

    if (term.pid && projectId) {
      detectClaudeSessionId(term.pid, projectId, preExistingFiles, options.cwd);
    }

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

    // Buffer incoming messages until the session/PTY is ready.
    const pendingMessages = [];
    let sessionReady = false;

    function flushPendingMessages() {
      sessionReady = true;
      for (const msg of pendingMessages) {
        handleMessage(msg);
      }
      pendingMessages.length = 0;
    }

    function handleMessage(message) {
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
    }

    // Register WebSocket handlers immediately so they work even during async setup.
    ws.on('message', (message) => {
      if (!sessionReady) {
        pendingMessages.push(message);
        return;
      }
      handleMessage(message);
    });

    ws.on('close', () => {
      if (session) {
        session.ws = null;
        if (!session.exitPayload) {
          scheduleDestroy(sessionId);
        }
      }
    });

    ws.on('error', () => {
      if (session) {
        session.ws = null;
        if (!session.exitPayload) {
          scheduleDestroy(sessionId);
        }
      }
    });

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
      flushPendingMessages();
    } else {
      sessionId = crypto.randomUUID();
      const projectId = url.searchParams.get('projectId') || undefined;

      const startSession = (appendSystemPrompt) => {
        const resumed = Boolean(projectId && getClaudeSessionId(projectId));
        const result = createSession(sessionId, { appendSystemPrompt, projectId });
        if (result.error) {
          sendText(`\r\n${result.error}\r\n`);
          ws.close();
          return;
        }

        session = result.session;
        session.ws = ws;
        sendText(JSON.stringify({ type: 'session', sessionId, resumed }));
        flushPendingMessages();
      };

      if (options.getSystemPrompt) {
        Promise.resolve(options.getSystemPrompt(url.searchParams))
          .then((prompt) => startSession(prompt || undefined))
          .catch((err) => {
            console.error('getSystemPrompt failed:', err);
            startSession(undefined);
          });
        return;
      }

      startSession(undefined);
    }
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
