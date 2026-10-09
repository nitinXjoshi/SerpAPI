import { Router } from 'express';
import { buildEventFeed, buildEventDetail } from '../events/feed.js';
import { getEvent, setEventStatus, listNotifications, setNotificationState } from '../events/store.js';
import { investigateEvent } from '../ollama/investigate.js';
import { scoreEventById } from '../scoring/opportunity.js';

const router = Router();

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const status = req.query.status || null;
  res.json({ events: buildEventFeed({ limit, status }) });
});

router.get('/notifications', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ notifications: listNotifications({ limit, state: req.query.state || null }) });
});

router.post('/notifications/:id/:state', (req, res) => {
  setNotificationState(req.params.id, req.params.state);
  res.json({ ok: true });
});

router.get('/:id', (req, res) => {
  const detail = buildEventDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Event not found.' });
  res.json(detail);
});

router.post('/:id/status', (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!['new', 'acknowledged', 'dismissed', 'saved', 'following'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const event = setEventStatus(req.params.id, status);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json({ event });
});

router.post('/:id/investigate', async (req, res) => {
  const result = await investigateEvent(req.params.id);
  if (result.error === 'Event not found.') return res.status(404).json(result);
  if (result.ok) scoreEventById(req.params.id);
  res.json({ ...result, detail: buildEventDetail(req.params.id) });
});

router.post('/:id/score', (req, res) => {
  const scoring = scoreEventById(req.params.id);
  if (!scoring) return res.status(404).json({ error: 'Event not found.' });
  res.json({ scoring, detail: buildEventDetail(req.params.id) });
});

router.post('/:id/followup', (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  const queries = event.model?.follow_up_queries || [];
  res.json({
    eventId: event.id,
    suggestedQueries: queries,
    note: 'Follow-up searches are suggestions only; they are not executed automatically.',
  });
});

export default router;
