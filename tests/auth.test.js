import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import {
  verifyCredentials,
  createSession,
  getSession,
  destroySession,
  requireAuth,
  sameOriginGuard,
  readCookie,
  setSessionCookie,
  _clearSessionsForTests,
  _addSessionForTests,
} from '../src/security/auth.js';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  res.set = (k, v) => ((res.headers[k.toLowerCase()] = v), res);
  res.append = (k, v) => ((res.headers[k.toLowerCase()] = v), res);
  res.on = () => res;
  return res;
}
function mockReq({ method = 'GET', url = '/api/status', headers = {} } = {}) {
  return { method, url, headers, ip: '127.0.0.1', secure: false };
}

test('verifyCredentials: password mode compares username and password', () => {
  config.auth.disabled = false;
  config.auth.username = 'admin';
  config.auth.password = 'correct horse battery staple';
  config.auth.token = null;
  assert.equal(verifyCredentials({ username: 'admin', password: 'correct horse battery staple' }), true);
  assert.equal(verifyCredentials({ username: 'admin', password: 'wrong' }), false);
  assert.equal(verifyCredentials({ username: 'root', password: 'correct horse battery staple' }), false);
  assert.equal(verifyCredentials({}), false);
  assert.equal(verifyCredentials({ username: 'admin' }), false);
});

test('verifyCredentials: token mode accepts the token in either field', () => {
  config.auth.password = null;
  config.auth.token = 'tok_abcdefghijklmnop';
  assert.equal(verifyCredentials({ token: 'tok_abcdefghijklmnop' }), true);
  assert.equal(verifyCredentials({ password: 'tok_abcdefghijklmnop' }), true);
  assert.equal(verifyCredentials({ token: 'nope' }), false);
  assert.equal(verifyCredentials({}), false);
  config.auth.token = null;
});

test('sessions are created, retrievable and destroyed', () => {
  _clearSessionsForTests();
  const { sid, expiresAt } = createSession('admin');
  assert.ok(expiresAt > Date.now());
  const s = getSession(sid);
  assert.equal(s.user, 'admin');
  destroySession(sid);
  assert.equal(getSession(sid), null);
  assert.equal(getSession('does-not-exist'), null);
  assert.equal(getSession(null), null);
});

test('expired sessions are rejected', () => {
  _clearSessionsForTests();
  _addSessionForTests('expired', { user: 'admin', createdAt: 0, expiresAt: Date.now() - 1000 });
  assert.equal(getSession('expired'), null, 'expired session must not be returned');
});

test('requireAuth rejects requests without a valid session, accepts valid ones', () => {
  _clearSessionsForTests();
  config.auth.disabled = false;

  const res1 = mockRes();
  let next1 = false;
  requireAuth(mockReq(), res1, () => (next1 = true));
  assert.equal(next1, false);
  assert.equal(res1.statusCode, 401);
  assert.equal(res1.body.code, 'unauthenticated');

  const { sid } = createSession('admin');
  const res2 = mockRes();
  let next2 = false;
  const req2 = mockReq({ headers: { cookie: `${config.auth.cookieName}=${sid}` } });
  requireAuth(req2, res2, () => (next2 = true));
  assert.equal(next2, true);
  assert.equal(req2.user.name, 'admin');

  const res3 = mockRes();
  requireAuth(mockReq({ headers: { cookie: `${config.auth.cookieName}=bogus` } }), res3, () => {});
  assert.equal(res3.statusCode, 401);
});

test('AUTH_DISABLED bypasses auth but only when explicitly configured', () => {
  _clearSessionsForTests();
  config.auth.disabled = true;
  const res = mockRes();
  let next = false;
  const req = mockReq();
  requireAuth(req, res, () => (next = true));
  assert.equal(next, true);
  assert.equal(req.user.insecure, true);
  config.auth.disabled = false;
});

test('sameOriginGuard blocks cross-site and cross-origin state changes', () => {
  const post = (headers) => {
    const res = mockRes();
    let next = false;
    sameOriginGuard(mockReq({ method: 'POST', headers }), res, () => (next = true));
    return { next, res };
  };
  assert.equal(post({ 'sec-fetch-site': 'cross-site' }).next, false);
  assert.equal(post({ 'sec-fetch-site': 'cross-site' }).res.statusCode, 403);
  assert.equal(post({ origin: 'https://evil.example', host: 'localhost:3000' }).next, false);
  assert.equal(post({ origin: 'http://localhost:3000', host: 'localhost:3000' }).next, true);
  assert.equal(post({}).next, true, 'non-browser clients (no Origin) are allowed; cookie is SameSite=Strict');

  const res = mockRes();
  let next = false;
  sameOriginGuard(mockReq({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }), res, () => (next = true));
  assert.equal(next, true, 'safe methods are not blocked');
});

test('session cookie is set HttpOnly + SameSite=Strict, and Secure only over HTTPS', () => {
  _clearSessionsForTests();
  const plain = mockRes();
  setSessionCookie(mockReq(), plain, 'sid123');
  const v1 = plain.headers['set-cookie'];
  assert.match(v1, /HttpOnly/);
  assert.match(v1, /SameSite=Strict/);
  assert.doesNotMatch(v1, /Secure/);

  const https = mockRes();
  setSessionCookie({ ...mockReq(), secure: true }, https, 'sid123');
  assert.match(https.headers['set-cookie'], /Secure/);
});

test('readCookie parses the session cookie', () => {
  assert.equal(readCookie({ headers: { cookie: 'a=1; ti_session=abc; b=2' } }), 'abc');
  assert.equal(readCookie({ headers: {} }), null);
});
