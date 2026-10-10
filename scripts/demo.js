#!/usr/bin/env node
/**
 * Judge demo launcher.
 *
 *   npm run demo
 *
 * Explicitly enables the read-only demo mode:
 *   - no login screen (an unauthenticated, read-only demo principal)
 *   - fixture-only providers (zero SerpApi / Twelve Data calls)
 *   - no Ollama requests
 *   - an ephemeral in-memory database (never touches your real data or stored keys)
 *   - loopback-only binding
 *
 * Values already present in the environment win, so `.env` can still override HOST/PORT.
 */
process.env.DEMO_MODE = 'true';
process.env.HOST = process.env.HOST || '127.0.0.1';
process.env.DB_PATH = ':memory:';

await import('../server.js');
