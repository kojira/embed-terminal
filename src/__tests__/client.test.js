// @vitest-environment jsdom

function loadClientModule() {
  const modulePath = require.resolve('../client.js');
  delete require.cache[modulePath];
  return require('../client.js');
}

function installAssetMocks() {
  const originalAppendChild = document.head.appendChild.bind(document.head);

  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    const result = originalAppendChild(node);
    queueMicrotask(() => {
      if (typeof node.onload === 'function') {
        node.onload();
      }
    });
    return result;
  });
}

function installRuntimeMocks() {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

  global.requestAnimationFrame = (cb) => cb();

  global.FitAddon = {
    FitAddon: class {
      constructor() {
        this.fit = vi.fn();
      }
    },
  };

  global.WebLinksAddon = {
    WebLinksAddon: class {},
  };

  global.Terminal = class {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
      this.loadAddon = vi.fn();
      this.open = vi.fn();
      this.onData = vi.fn();
      this.clear = vi.fn();
      this.write = vi.fn();
      this.resize = vi.fn((cols, rows) => {
        this.cols = cols;
        this.rows = rows;
      });
      this.dispose = vi.fn();
    }
  };

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.listeners = {};
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this._emit('open');
      });
    }

    addEventListener(event, cb) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(cb);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this._emit('close');
    }

    _emit(event, payload) {
      const listeners = this.listeners[event] || [];
      for (const listener of listeners) {
        listener(payload);
      }
    }
  }

  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSED = 3;

  global.WebSocket = FakeWebSocket;
}

describe('ChatTerminal', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="terminal"></div>';
    installAssetMocks();
    installRuntimeMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.Terminal;
    delete global.FitAddon;
    delete global.WebLinksAddon;
    delete global.WebSocket;
    delete global.ResizeObserver;
    delete global.requestAnimationFrame;
  });

  it('stores constructor options on instantiation', async () => {
    const { ChatTerminal } = loadClientModule();
    const container = document.getElementById('terminal');
    const terminal = new ChatTerminal(container, {
      wsUrl: 'ws://localhost:9999/ws',
      fontSize: 16,
      fontFamily: 'Fira Code',
    });

    await terminal.ready;

    expect(terminal.container).toBe(container);
    expect(terminal.options.wsUrl).toBe('ws://localhost:9999/ws');
    expect(terminal.options.fontSize).toBe(16);
    expect(terminal.options.fontFamily).toBe('Fira Code');

    terminal.dispose();
  });

  it('stores font and theme-related options', async () => {
    const { ChatTerminal } = loadClientModule();
    const container = document.getElementById('terminal');
    const terminal = new ChatTerminal(container, {
      fontSize: 18,
      fontFamily: 'Iosevka',
      theme: 'light',
    });

    await terminal.ready;

    expect(terminal.options.fontSize).toBe(18);
    expect(terminal.options.fontFamily).toBe('Iosevka');
    expect(terminal.options.theme).toMatchObject({
      background: '#ffffff',
      foreground: '#24292f',
    });

    terminal.dispose();
  });

  it('resolves string theme presets and preserves object themes', async () => {
    const { ChatTerminal } = loadClientModule();
    const container = document.getElementById('terminal');
    const directTheme = {
      background: '#010203',
      foreground: '#fefefe',
    };
    const presetTerminal = new ChatTerminal(container, { theme: 'default' });

    await presetTerminal.ready;

    expect(presetTerminal.options.theme).toMatchObject({
      background: '#141625',
      foreground: '#e6edf7',
    });

    presetTerminal.dispose();

    const directTerminal = new ChatTerminal(container, { theme: directTheme });
    await directTerminal.ready;

    expect(directTerminal.options.theme).toBe(directTheme);

    directTerminal.dispose();
  });

  it('throws when no container is provided', () => {
    const { ChatTerminal } = loadClientModule();

    expect(() => new ChatTerminal()).toThrow(TypeError);
    expect(() => new ChatTerminal(null, {})).toThrow('ChatTerminal requires a container element');
  });

  it('stores header and controls options', async () => {
    const { ChatTerminal } = loadClientModule();
    const container = document.getElementById('terminal');
    const terminal = new ChatTerminal(container, {
      header: false,
      controls: { fontSize: true, mobile: false },
    });

    await terminal.ready;

    expect(terminal.options.header).toBe(false);
    expect(terminal.options.controls).toEqual({ fontSize: true, mobile: false });

    terminal.dispose();
  });
});
