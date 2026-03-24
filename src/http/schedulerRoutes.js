// src/http/schedulerRoutes.js
// HTTP endpoints for the central scheduler to trigger MondayBot jobs

import express from 'express';
import { runDailySync } from '../jobs/dailySync.js';
import { postWeeklySummary } from '../jobs/weeklySummary.js';
import { reconcileComments } from '../jobs/commentReconciler.js';
import { updateAllPinnedPosts } from '../services/projectSyncOrchestrator.js';

const router = express.Router();

// Auth middleware
function auth(req, res, next) {
  const token = process.env.SCHEDULER_TOKEN;
  if (!token) return next();
  if (req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(auth);

// Store Discord client reference
let discordClient = null;
export function setClient(client) { discordClient = client; }

router.post('/daily-sync', async (req, res) => {
  const start = Date.now();
  try {
    await runDailySync(discordClient);
    res.json({ success: true, message: 'Daily sync complete', durationMs: Date.now() - start });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, durationMs: Date.now() - start });
  }
});

router.post('/weekly-summary', async (req, res) => {
  const start = Date.now();
  try {
    await postWeeklySummary(discordClient);
    res.json({ success: true, message: 'Weekly summary posted', durationMs: Date.now() - start });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, durationMs: Date.now() - start });
  }
});

router.post('/comment-reconciler', async (req, res) => {
  const start = Date.now();
  try {
    const result = await reconcileComments(discordClient);
    res.json({ success: true, message: 'Comment reconciliation complete', ...result, durationMs: Date.now() - start });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, durationMs: Date.now() - start });
  }
});

router.post('/refresh-pinned-posts', async (req, res) => {
  const start = Date.now();
  try {
    const result = await updateAllPinnedPosts(discordClient);
    res.json({ success: true, message: 'Pinned posts refreshed', ...result, durationMs: Date.now() - start });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, durationMs: Date.now() - start });
  }
});

export default router;
