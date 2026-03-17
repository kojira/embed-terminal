import http from 'node:http';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const serverDeps = require('../server-deps.js');

function createFakePty() {
  const handlers = {};
  const pty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    on(event, cb) {
      handlers[event] = cb;
    },
    onData(cb) {
      handlers.data = cb;
    },
    onExit(cb) {
      handlers.exit = cb;
    },
    emitData(data) {
      if (handlers.data) {
        handlers.data(data);
      }
    },
    emitExit(exitCode) {
      if (handlers.exit) {
        handlers.exit({ exitCode });
      }
    },
  };

  return pty;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address());
    });
  });
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function openClient(address, search) {
  return new Promise((resolve, reject) => {
    const suffix = search || '';
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws${suffix}`);

    client.once('open', () => resolve(client));
    client.once('error', reject);
  });
}

function waitForMessage(client) {
  return new Promise((resolve) => {
    client.once('message', (data) => {
      resolve(data.toString());
    });
  });
}

function waitForClose(client) {
  return new Promise((resolve) => {
    client.once('close', resolve);
  });
}

function terminateClient(client) {
  if (!client || client.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeoutId);
      client.off('close', finish);
      client.off('error', finish);
      resolve();
    };

    const timeoutId = setTimeout(finish, 1000);
    client.once('close', finish);
    client.once('error', finish);
    client.terminate();
  });
}

describe('createChatServer', () => {
  let server;
  let chat;
  let createChatServer;
  let spawnPtyMock;
  let spawnSyncMock;

  beforeEach(() => {
    spawnPtyMock = vi.spyOn(serverDeps, 'spawnPty').mockImplementation(() => createFakePty());
    spawnSyncMock = vi.spyOn(serverDeps, 'spawnSync').mockReturnValue({ status: 0 });
    delete require.cache[require.resolve('../server.js')];
    ({ createChatServer } = require('../server.js'));
    server = http.createServer();
    chat = null;
  });

  afterEach(async () => {
    if (chat) {
      await chat.close();
    }

    if (server && server.listening) {
      await closeHttpServer(server);
    }

    spawnPtyMock.mockRestore();
    spawnSyncMock.mockRestore();
  });

  it('returns wss, sessions, and close for a valid http server', async () => {
    chat = createChatServer(server);

    expect(chat.wss).toBeTruthy();
    expect(chat.sessions).toBeInstanceOf(Map);
    expect(typeof chat.close).toBe('function');
  });

  it('accepts a websocket connection and sends a session payload', async () => {
    chat = createChatServer(server);
    const address = await listen(server);
    const client = await openClient(address);

    const message = JSON.parse(await waitForMessage(client));

    expect(message.type).toBe('session');
    expect(message.sessionId).toEqual(expect.any(String));
    expect(chat.sessions.has(message.sessionId)).toBe(true);

    await terminateClient(client);
  }, 15000);

  it('uses codex only for the codex provider and claude otherwise', async () => {
    const codexServer = http.createServer();
    const fallbackServer = http.createServer();
    const codexChat = createChatServer(codexServer, { provider: 'codex' });
    const fallbackChat = createChatServer(fallbackServer, { provider: 'something-else' });
    let codexClient = null;
    let fallbackClient = null;

    try {
      const [codexAddress, fallbackAddress] = await Promise.all([
        listen(codexServer),
        listen(fallbackServer),
      ]);

      codexClient = await openClient(codexAddress);
      await waitForMessage(codexClient);
      await terminateClient(codexClient);
      codexClient = null;

      fallbackClient = await openClient(fallbackAddress);
      await waitForMessage(fallbackClient);
      await terminateClient(fallbackClient);
      fallbackClient = null;

      expect(spawnPtyMock).toHaveBeenNthCalledWith(
        1,
        'codex',
        [],
        expect.objectContaining({ cols: 80, rows: 24 })
      );
      expect(spawnPtyMock).toHaveBeenNthCalledWith(
        2,
        'claude',
        [],
        expect.objectContaining({ cols: 80, rows: 24 })
      );
    } finally {
      if (codexClient) {
        await terminateClient(codexClient);
      }

      if (fallbackClient) {
        await terminateClient(fallbackClient);
      }

      await codexChat.close();
      await fallbackChat.close();
      await closeHttpServer(codexServer);
      await closeHttpServer(fallbackServer);
    }
  }, 15000);

  it('tracks sessions for active connections and clears them on close()', async () => {
    chat = createChatServer(server);
    const address = await listen(server);
    const firstClient = await openClient(address);
    const firstMessage = JSON.parse(await waitForMessage(firstClient));
    const secondClient = await openClient(address);
    const secondMessage = JSON.parse(await waitForMessage(secondClient));

    expect(chat.sessions.size).toBe(2);
    expect(chat.sessions.has(firstMessage.sessionId)).toBe(true);
    expect(chat.sessions.has(secondMessage.sessionId)).toBe(true);

    await terminateClient(firstClient);
    await terminateClient(secondClient);
    await chat.close();
    chat = null;

    expect(firstClient.readyState).toBe(WebSocket.CLOSED);
    expect(secondClient.readyState).toBe(WebSocket.CLOSED);
    expect(spawnPtyMock.mock.results[0].value.kill).toHaveBeenCalledTimes(1);
    expect(spawnPtyMock.mock.results[1].value.kill).toHaveBeenCalledTimes(1);
  }, 15000);

  it('throws when no http server is provided', () => {
    expect(() => createChatServer()).toThrow(TypeError);
    expect(() => createChatServer({})).toThrow('createChatServer requires an http.Server instance');
  });
});
