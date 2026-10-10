import { Router } from 'express';
import { buildEventFeed, buildEventDetail } from '../events/feed.js';
import { getEvent, setEventStatus, listNotifications, setNotificationState } from '../events/store.js';
import { investigateEvent } from '../ollama/investigate.js';
import { scoreEventById } from '../scoring/opportunity.js';
import { createConcurrencyGuard } from '../security/rateLimit.js';
import { asyncHandler } from '../security/errors.js';
import { asId, asInt, asEnum, NOTIFICATION_STATES, EVENT_STATUSES } from '../security/validate.js';

const router = Router();
const investigateGuard = createConcurrencyGuard(1, 'An investigation is already running.');

function queryLimit(value, fallback, max, field = 'limit') {
  if (value === undefined) return fallback;
  return asInt(value, { field, min: 1, max });
}

router.get('/', (req, res) => {
  const limit = queryLimit(req.query.limit, 50, 200);
  const status = req.query.status === undefined ? null : asEnum(req.query.status, EVENT_STATUSES, { field: 'status' });
  res.json({ events: buildEventFeed({ limit, status }) });
});

router.get('/notifications', (req, res) => {
  const limit = queryLimit(req.query.limit, 50, 200);
  const state = req.query.state === undefined ? null : asEnum(req.query.state, NOTIFICATION_STATES, { field: 'state' });
  res.json({ notifications: listNotifications({ limit, state }) });
});

router.post('/notifications/:id/:state', (req, res) => {
  const id = asId(req.params.id, { field: 'notification id' });
  const state = asEnum(req.params.state, NOTIFICATION_STATES, { field: 'state' });
  setNotificationState(id, state);
  res.json({ ok: true });
});

router.get('/:id', (req, res) => {
  const id = asId(req.params.id, { field: 'event id' });
  const detail = buildEventDetail(id);
  if (!detail) return res.status(404).json({ error: 'Event not found.' });
  res.json(detail);
});

router.post('/:id/status', (req, res) => {
  const id = asId(req.params.id, { field: 'event id' });
  const status = asEnum(String(req.body?.status || '').trim(), EVENT_STATUSES, { field: 'status' });
  const event = setEventStatus(id, status);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json({ event });
});

router.post(
  '/:id/investigate',
  investigateGuard,
  asyncHandler(async (req, res) => {
    const id = asId(req.params.id, { field: 'event id' });
    const result = await investigateEvent(id);
    if (result.error === 'Event not found.') return res.status(404).json({ error: 'Event not found.' });
    if (result.ok) scoreEventById(id);
    res.json({ ...result, detail: buildEventDetail(id) });
  }),
);

router.post('/:id/score', (req, res) => {
  const id = asId(req.params.id, { field: 'event id' });
  const scoring = scoreEventById(id);
  if (!scoring) return res.status(404).json({ error: 'Event not found.' });
  res.json({ scoring, detail: buildEventDetail(id) });
});

router.post('/:id/followup', (req, res) => {
  const id = asId(req.params.id, { field: 'event id' });
  const event = getEvent(id);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  const queries = event.model?.follow_up_queries || [];
  res.json({
    eventId: event.id,
    suggestedQueries: queries,
    note: 'Follow-up searches are suggestions only; they are not executed automatically.',
  });
});

export default router;
