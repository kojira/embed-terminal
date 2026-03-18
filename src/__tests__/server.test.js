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
    client._messageQueue = [];
    client.on('message', (data) => {
      client._messageQueue.push(data.toString());
    });

    client.once('open', () => resolve(client));
    client.once('error', reject);
  });
}

function openClientWithCollector(address, search) {
  return new Promise((resolve, reject) => {
    const suffix = search || '';
    const messages = [];
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws${suffix}`);

    client.on('message', (data) => {
      messages.push(data.toString());
    });
    client.once('open', () => resolve({ client, messages }));
    client.once('error', reject);
  });
}

function waitForMessage(client) {
  return new Promise((resolve) => {
    if (Array.isArray(client._messageQueue) && client._messageQueue.length > 0) {
      resolve(client._messageQueue.shift());
      return;
    }

    client.once('message', (data) => {
      resolve(data.toString());
    });
  });
}

function waitForMessages(client, count) {
  return new Promise((resolve) => {
    const messages = Array.isArray(client._messageQueue) ? client._messageQueue.splice(0, count) : [];
    if (messages.length >= count) {
      resolve(messages);
      return;
    }

    const handleMessage = (data) => {
      messages.push(data.toString());
      if (messages.length >= count) {
        client.off('message', handleMessage);
        resolve(messages);
      }
    };

    client.on('message', handleMessage);
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

  it('sends error and closes when command is not found', async () => {
    spawnSyncMock.mockReturnValue({ status: 1 });
    chat = createChatServer(server);
    const address = await listen(server);
    const { client, messages } = await openClientWithCollector(address);

    await vi.waitFor(() => {
      expect(messages).toHaveLength(1);
    });

    const errorMessage = messages[0];

    expect(errorMessage).toContain('not found');

    if (client.readyState !== WebSocket.CLOSED) {
      await waitForClose(client);
    }
    expect(client.readyState).toBe(WebSocket.CLOSED);
  }, 15000);

  it('replays buffer when reconnecting with existing sessionId', async () => {
    chat = createChatServer(server);
    const address = await listen(server);
    const { client: client1, messages: client1Messages } = await openClientWithCollector(address);

    await vi.waitFor(() => {
      expect(client1Messages.length).toBeGreaterThanOrEqual(1);
    });

    const sessionMessage = JSON.parse(client1Messages[0]);
    const sessionId = sessionMessage.sessionId;
    const pty = spawnPtyMock.mock.results[0].value;

    pty.emitData('buffered output');
    await terminateClient(client1);

    const { client: client2, messages } = await openClientWithCollector(address, `?sessionId=${sessionId}`);

    await vi.waitFor(() => {
      expect(messages).toHaveLength(4);
    });

    expect(JSON.parse(messages[0])).toEqual({ type: 'session', sessionId });
    expect(JSON.parse(messages[1])).toEqual({ type: 'replay-start' });
    expect(messages[2]).toBe('buffered output');
    expect(JSON.parse(messages[3])).toEqual({ type: 'replay-end' });
    await terminateClient(client2);
  }, 15000);

  it('handles resize messages from client', async () => {
    chat = createChatServer(server);
    const address = await listen(server);
    const { client, messages } = await openClientWithCollector(address);

    await vi.waitFor(() => {
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
    const pty = spawnPtyMock.mock.results[0].value;
    client.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));

    await vi.waitFor(() => {
      expect(pty.resize).toHaveBeenCalledWith(120, 40);
    });

    await terminateClient(client);
  }, 15000);

  it('forwards terminal input to PTY', async () => {
    chat = createChatServer(server);
    const address = await listen(server);
    const { client, messages } = await openClientWithCollector(address);

    await vi.waitFor(() => {
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
    const pty = spawnPtyMock.mock.results[0].value;
    client.send('hello');

    await vi.waitFor(() => {
      expect(pty.write).toHaveBeenCalledWith('hello');
    });

    await terminateClient(client);
  }, 15000);

  it('sends exit payload when PTY exits', async () => {
    chat = createChatServer(server);
    const address = await listen(server);
    const { client, messages } = await openClientWithCollector(address);

    await vi.waitFor(() => {
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
    const pty = spawnPtyMock.mock.results[0].value;

    pty.emitExit(0);

    await vi.waitFor(() => {
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    expect(JSON.parse(messages[1])).toEqual({ type: 'exit', code: 0 });

    await terminateClient(client);
  }, 15000);

});
