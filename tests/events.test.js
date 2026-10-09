import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { createEvent, notifyOnce, listNotifications, setEventStatus, getEvent, attachArticle } from '../src/events/store.js';

initDb();

test('notification dedupe prevents repeats for the same event/band', () => {
  const ev = createEvent({ clusterKey: 'TEST:1', title: 'x', symbols: ['NVDA'], firstSeenTs: new Date().toISOString() });
  const first = notifyOnce({ eventId: ev.id, dedupeKey: `event:${ev.id}:watch` });
  const second = notifyOnce({ eventId: ev.id, dedupeKey: `event:${ev.id}:watch` });
  assert.equal(first, true);
  assert.equal(second, false, 'same dedupe key must not notify twice');
  // a different band may notify again
  assert.equal(notifyOnce({ eventId: ev.id, dedupeKey: `event:${ev.id}:potential_opportunity` }), true);
  assert.equal(listNotifications().filter((n) => n.eventId === ev.id).length, 2);
});

test('event status transitions are persisted', () => {
  const ev = createEvent({ clusterKey: 'TEST:2', title: 'y', symbols: ['AMD'] });
  setEventStatus(ev.id, 'acknowledged');
  assert.equal(getEvent(ev.id).status, 'acknowledged');
  setEventStatus(ev.id, 'dismissed');
  assert.equal(getEvent(ev.id).status, 'dismissed');
});

test('attaching an article twice is idempotent', () => {
  const ev = createEvent({ clusterKey: 'TEST:3', title: 'z', symbols: ['MSFT'] });
  assert.equal(attachArticle(ev.id, 'hash-a', true), true);
  assert.equal(attachArticle(ev.id, 'hash-a', true), false);
});
