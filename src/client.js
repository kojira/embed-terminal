(function (globalFactory) {
  const globalScope =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : typeof self !== 'undefined'
          ? self
          : this;

  const ChatTerminal = globalFactory(globalScope);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports.ChatTerminal = ChatTerminal;
  } else if (typeof exports === 'object') {
    exports.ChatTerminal = ChatTerminal;
  }

  if (globalScope) {
    globalScope.ChatTerminal = ChatTerminal;
    if (globalScope.window) {
      globalScope.window.ChatTerminal = ChatTerminal;
    }
  }
})(function (global) {
  'use strict';

  const ASSET_URLS = {
    css: 'https://unpkg.com/xterm@5.3.0/css/xterm.css',
    xterm: 'https://unpkg.com/xterm@5.3.0/lib/xterm.js',
    fit: 'https://unpkg.com/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js',
    webLinks: 'https://unpkg.com/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js',
  };
  const DEFAULT_THEME = {
    background: '#141625',
    foreground: '#e6edf7',
    cursor: '#7dd3fc',
    selectionBackground: 'rgba(125, 211, 252, 0.25)',
    black: '#141625',
    red: '#ff7b72',
    green: '#7ee787',
    yellow: '#f2cc60',
    blue: '#79c0ff',
    magenta: '#d2a8ff',
    cyan: '#7dd3fc',
    white: '#e6edf7',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#a5d6ff',
    brightMagenta: '#e2b8ff',
    brightCyan: '#a5f3fc',
    brightWhite: '#f0f6fc',
  };
  const THEME_PRESETS = {
    default: DEFAULT_THEME,
    dark: DEFAULT_THEME,
    light: {
      background: '#ffffff',
      foreground: '#24292f',
      cursor: '#0969da',
      selectionBackground: 'rgba(9, 105, 218, 0.2)',
      black: '#24292f',
      red: '#cf222e',
      green: '#1a7f37',
      yellow: '#9a6700',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#116329',
      brightYellow: '#7d4e00',
      brightBlue: '#0550ae',
      brightMagenta: '#6639ba',
      brightCyan: '#0a6068',
      brightWhite: '#24292f',
    },
    monokai: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      selectionBackground: 'rgba(73, 72, 62, 0.6)',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5',
    },
    dracula: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: 'rgba(68, 71, 90, 0.6)',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  };

  let assetsPromise = null;

  function resolveTheme(theme) {
    if (theme && typeof theme === 'object') {
      return theme;
    }

    if (typeof theme === 'string') {
      return THEME_PRESETS[theme.toLowerCase()] || DEFAULT_THEME;
    }

    return DEFAULT_THEME;
  }

  function loadStylesheet(href) {
    if (!global.document) {
      return Promise.resolve();
    }

    const existing = global.document.querySelector('link[data-cli-chat-terminal="' + href + '"]');
    if (existing) {
      return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
      const link = global.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.cliChatTerminal = href;
      link.onload = function () {
        resolve();
      };
      link.onerror = function () {
        reject(new Error('Failed to load stylesheet: ' + href));
      };
      global.document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    if (!global.document) {
      return Promise.resolve();
    }

    const existing = global.document.querySelector('script[data-cli-chat-terminal="' + src + '"]');
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        return Promise.resolve();
      }

      return new Promise(function (resolve, reject) {
        existing.addEventListener('load', function onLoad() {
          existing.removeEventListener('load', onLoad);
          resolve();
        });
        existing.addEventListener('error', function onError() {
          existing.removeEventListener('error', onError);
          reject(new Error('Failed to load script: ' + src));
        });
      });
    }

    return new Promise(function (resolve, reject) {
      const script = global.document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.cliChatTerminal = src;
      script.onload = function () {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Failed to load script: ' + src));
      };
      global.document.head.appendChild(script);
    });
  }

  function loadAssets() {
    if (!assetsPromise) {
      assetsPromise = loadStylesheet(ASSET_URLS.css)
        .then(function () {
          return loadScript(ASSET_URLS.xterm);
        })
        .then(function () {
          return loadScript(ASSET_URLS.fit);
        })
        .then(function () {
          return loadScript(ASSET_URLS.webLinks);
        });
    }

    return assetsPromise;
  }

  function getDefaultWsUrl() {
    if (!global.location) {
      return 'ws://localhost:3456/ws';
    }

    const protocol = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return protocol + '//' + global.location.host + '/ws';
  }

  function createEventDetail(instance, detail) {
    const payload = detail || {};
    payload.sessionId = instance.sessionId;
    return payload;
  }

  function ChatTerminal(container, options) {
    if (!(this instanceof ChatTerminal)) {
      return new ChatTerminal(container, options);
    }

    if (!container || !container.nodeType) {
      throw new TypeError('ChatTerminal requires a container element');
    }

    options = options || {};

    this.container = container;
    this.options = {
      wsUrl: options.wsUrl || getDefaultWsUrl(),
      fontSize: options.fontSize || 14,
      fontFamily: options.fontFamily || '"JetBrains Mono", monospace',
      theme: resolveTheme(options.theme),
      header: options.header,
      controls: options.controls,
      onConnect: options.onConnect || null,
      onDisconnect: options.onDisconnect || null,
      onExit: options.onExit || null,
    };

    this.onConnect = this.options.onConnect;
    this.onDisconnect = this.options.onDisconnect;
    this.onExit = this.options.onExit;
    this.sessionId = null;
    this.socket = null;
    this.terminal = null;
    this.fitAddon = null;
    this.webLinksAddon = null;
    this.resizeObserver = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.intentionalClose = false;
    this.disposed = false;
    this.inputTransformer = null;

    this._handleWindowResize = this._handleWindowResize.bind(this);
    this.ready = this._init();
  }

  ChatTerminal.prototype._init = function () {
    const self = this;

    return loadAssets().then(function () {
      if (self.disposed) {
        return;
      }

      const TerminalCtor = global.Terminal;
      const FitAddonCtor = global.FitAddon && global.FitAddon.FitAddon;
      const WebLinksAddonCtor = global.WebLinksAddon && global.WebLinksAddon.WebLinksAddon;

      if (!TerminalCtor || !FitAddonCtor || !WebLinksAddonCtor) {
        throw new Error('xterm.js assets did not load correctly');
      }

      self.terminal = new TerminalCtor({
        convertEol: true,
        cursorBlink: true,
        fontFamily: self.options.fontFamily,
        fontSize: self.options.fontSize,
        lineHeight: 1.35,
        theme: self.options.theme,
      });

      self.fitAddon = new FitAddonCtor();
      self.webLinksAddon = new WebLinksAddonCtor();
      self.terminal.loadAddon(self.fitAddon);
      self.terminal.loadAddon(self.webLinksAddon);
      self.terminal.open(self.container);
      self.terminal.onData(function (data) {
        self._sendTerminalInput(data);
      });

      if (global.requestAnimationFrame) {
        global.requestAnimationFrame(function () {
          self.fit();
          self.connect();
        });
      } else {
        self.fit();
        self.connect();
      }

      if (global.addEventListener) {
        global.addEventListener('resize', self._handleWindowResize);
      }

      if (global.ResizeObserver) {
        self.resizeObserver = new global.ResizeObserver(function () {
          self.fit();
        });
        self.resizeObserver.observe(self.container);
      }
    });
  };

  ChatTerminal.prototype._handleWindowResize = function () {
    this.fit();
  };

  ChatTerminal.prototype._emit = function (eventName, detail, callbackName) {
    const payload = createEventDetail(this, detail);
    const callback = this[callbackName];

    if (typeof callback === 'function') {
      callback(payload);
    }

    if (this.container && typeof global.CustomEvent === 'function') {
      this.container.dispatchEvent(
        new global.CustomEvent('chatterminal:' + eventName, {
          detail: payload,
        })
      );
    }
  };

  ChatTerminal.prototype._clearReconnectTimer = function () {
    if (!this.reconnectTimer) {
      return;
    }

    global.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  };

  ChatTerminal.prototype._scheduleReconnect = function () {
    const self = this;

    if (this.disposed || this.intentionalClose || this.reconnectTimer) {
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectTimer = global.setTimeout(function () {
      self.reconnectTimer = null;
      self.reconnectAttempts += 1;
      self.connect();
    }, delay);
  };

  ChatTerminal.prototype._sendResize = function () {
    if (!this.socket || this.socket.readyState !== global.WebSocket.OPEN || !this.terminal) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: 'resize',
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      })
    );
  };

  ChatTerminal.prototype._sendTerminalInput = function (data) {
    if (!this.socket || this.socket.readyState !== global.WebSocket.OPEN) {
      return;
    }

    if (typeof this.inputTransformer === 'function') {
      data = this.inputTransformer(data);
      if (!data) {
        return;
      }
    }

    this.socket.send(data);
  };

  ChatTerminal.prototype._handleMessage = function (event) {
    if (!this.terminal || typeof event.data !== 'string') {
      return;
    }

    try {
      const payload = JSON.parse(event.data);
      if (payload && payload.type === 'session') {
        this.sessionId = payload.sessionId || null;
        return;
      }

      if (payload && payload.type === 'replay-start') {
        this.terminal.clear();
        return;
      }

      if (payload && payload.type === 'replay-end') {
        return;
      }

      if (payload && payload.type === 'exit') {
        this.intentionalClose = true;
        this.sessionId = null;
        this._emit('exit', { code: payload.code }, 'onExit');
        return;
      }
    } catch (_error) {
      // Terminal output is plain text.
    }

    this.terminal.write(event.data);
  };

  ChatTerminal.prototype.connect = function () {
    const self = this;

    if (this.disposed || !global.WebSocket) {
      return;
    }

    if (this.socket && (this.socket.readyState === global.WebSocket.OPEN || this.socket.readyState === global.WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;
    this._clearReconnectTimer();

    const url = new global.URL(this.options.wsUrl, global.location && global.location.href ? global.location.href : undefined);
    if (this.sessionId) {
      url.searchParams.set('sessionId', this.sessionId);
    }

    this.socket = new global.WebSocket(url.toString());

    this.socket.addEventListener('open', function () {
      self.reconnectAttempts = 0;
      self.fit();
      self._emit('connect', { wsUrl: url.toString() }, 'onConnect');
    });

    this.socket.addEventListener('message', function (event) {
      self._handleMessage(event);
    });

    this.socket.addEventListener('close', function () {
      self._emit('disconnect', {}, 'onDisconnect');
      if (!self.intentionalClose) {
        self._scheduleReconnect();
      }
    });

    this.socket.addEventListener('error', function () {
      self._emit('disconnect', { error: true }, 'onDisconnect');
    });
  };

  ChatTerminal.prototype.fit = function () {
    if (!this.fitAddon || !this.terminal) {
      return;
    }

    this.fitAddon.fit();
    this._sendResize();
  };

  ChatTerminal.prototype.resize = function (cols, rows) {
    if (!this.terminal) {
      return;
    }

    if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
      this.terminal.resize(cols, rows);
      this._sendResize();
    }
  };

  ChatTerminal.prototype.sendInput = function (text) {
    if (!this.socket || this.socket.readyState !== global.WebSocket.OPEN || typeof text !== 'string') {
      return;
    }

    this.socket.send(text);
  };

  ChatTerminal.prototype.setFontSize = function (fontSize) {
    if (!this.terminal || !Number.isFinite(fontSize) || fontSize <= 0) {
      return;
    }

    this.terminal.options.fontSize = fontSize;
    this.fit();
  };

  ChatTerminal.prototype.setInputTransformer = function (transformer) {
    this.inputTransformer = typeof transformer === 'function' ? transformer : null;
  };

  ChatTerminal.prototype.dispose = function () {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.intentionalClose = true;
    this._clearReconnectTimer();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (global.removeEventListener) {
      global.removeEventListener('resize', this._handleWindowResize);
    }

    if (this.socket) {
      try {
        this.socket.close();
      } catch (_error) {
        // Ignore close failures during disposal.
      }
      this.socket = null;
    }

    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
    }

    this.fitAddon = null;
    this.webLinksAddon = null;
    this.sessionId = null;
  };

  return ChatTerminal;
});
