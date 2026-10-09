import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Configure the environment BEFORE any src module is evaluated (import order matters).
const dir = mkdtempSync(path.join(tmpdir(), 'ti-test-'));
process.env.DATA_DIR = dir;
process.env.DB_PATH = ':memory:';
process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef';
process.env.LOG_LEVEL = 'error';
// NOTE: DEMO_MODE is deliberately NOT set — tests drive provider selection via settings,
// and DEMO_MODE would force the fixture provider regardless of configuration.

export const TEST_DIR = dir;
