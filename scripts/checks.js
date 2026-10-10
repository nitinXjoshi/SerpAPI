#!/usr/bin/env node
/**
 * Project security/health checks (no external calls, no paid APIs).
 *
 *  1. Syntax-checks every first-party JavaScript file.
 *  2. Scans the working tree for credential-shaped strings.
 *  3. Asserts that secret-bearing paths are git-ignored and untracked.
 *
 * Exits non-zero on any failure. Run with: npm run check
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', '.commandcode', 'dist', 'build']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/* 1. syntax check */
const files = [
  path.join(ROOT, 'server.js'),
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'public')),
  ...walk(path.join(ROOT, 'tests')),
  ...walk(path.join(ROOT, 'scripts')),
];
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`syntax error: ${path.relative(ROOT, file)}\n${err.stderr?.toString() || err.message}`);
  }
}

/* 2. credential-shaped strings (test fixtures are allowed to contain obvious fakes) */
const CREDENTIAL_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const ASSIGNMENT_PATTERN =
  /(api[_-]?key|apikey|secret|token|password)[^A-Za-z0-9]{0,4}[=:][^A-Za-z0-9]{0,4}["'`][A-Za-z0-9_\-+/]{16,}["'`]/i;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (rel.startsWith(`tests${path.sep}`)) continue; // fixtures intentionally contain fakes
  const text = readFileSync(file, 'utf8');
  for (const re of CREDENTIAL_PATTERNS) {
    if (re.test(text)) problems.push(`possible credential in ${rel} (matched ${re})`);
  }
  if (ASSIGNMENT_PATTERN.test(text)) {
    problems.push(`hard-coded secret-looking assignment in ${rel}`);
  }
}

/* 3. ignore / tracking assertions */
const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
for (const entry of ['node_modules/', '.env', 'data/']) {
  if (!gitignore.split(/\r?\n/).includes(entry)) {
    problems.push(`.gitignore is missing "${entry}"`);
  }
}

try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const forbidden = tracked.filter(
    (f) =>
      f === '.env' ||
      f.endsWith('/encryption.key') ||
      f.startsWith('data/') ||
      f.endsWith('.pem') ||
      f.endsWith('.key'),
  );
  if (forbidden.length) problems.push(`secret-bearing files are tracked: ${forbidden.join(', ')}`);
} catch {
  // git not available — the ignore file assertions above still ran.
}

if (problems.length) {
  console.error('✖ security checks failed:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✔ security checks passed (${files.length} files scanned, no credentials, ignores intact)`);
