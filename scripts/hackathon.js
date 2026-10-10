#!/usr/bin/env node
/**
 * Hackathon launcher — no sign-in page.
 *
 *   npm run hackathon
 *
 * Enables the explicit local hackathon mode:
 *   - the dashboard opens directly (no login screen, no redirect)
 *   - full application functionality (not read-only)
 *   - real providers are used; nothing is forced to fixtures
 *   - the normal persistent database and existing encryption key / stored credentials
 *     are used unchanged
 *   - bound to 127.0.0.1 only (the server refuses any non-loopback bind in this mode)
 *
 * Every other protection stays on: same-origin (CSRF) checks, input validation, rate
 * limits, concurrency guards, security headers, error redaction, and server-side key
 * storage with masking.
 *
 * Values already present in the environment win, so `.env` can still override HOST/PORT.
 */
process.env.HACKATHON_MODE = 'true';
process.env.HOST = process.env.HOST || '127.0.0.1';

await import('../server.js');
