#!/usr/bin/env node

const { startServer } = require('../src/server');

function parseArgs(argv) {
  const config = {
    provider: 'claude',
    port: 3456,
    host: '0.0.0.0',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--provider' && next) {
      config.provider = next;
      i += 1;
      continue;
    }

    if (arg === '--port' && next) {
      const parsedPort = Number(next);
      if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
        throw new Error(`Invalid --port value: ${next}`);
      }
      config.port = parsedPort;
      i += 1;
      continue;
    }

    if (arg === '--host' && next) {
      config.host = next;
      i += 1;
      continue;
    }

    if (arg.startsWith('--provider=')) {
      config.provider = arg.slice('--provider='.length);
      continue;
    }

    if (arg.startsWith('--port=')) {
      const parsedPort = Number(arg.slice('--port='.length));
      if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
        throw new Error(`Invalid --port value: ${arg.slice('--port='.length)}`);
      }
      config.port = parsedPort;
      continue;
    }

    if (arg.startsWith('--host=')) {
      config.host = arg.slice('--host='.length);
      continue;
    }
  }

  const normalizedProvider = String(config.provider).toLowerCase();
  if (normalizedProvider !== 'claude' && normalizedProvider !== 'codex') {
    throw new Error(`Invalid --provider value: ${config.provider}`);
  }
  config.provider = normalizedProvider;

  return config;
}

try {
  const config = parseArgs(process.argv.slice(2));
  startServer(config);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
