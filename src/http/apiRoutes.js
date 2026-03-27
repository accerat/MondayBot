// src/http/apiRoutes.js
// Cross-bot API endpoints for MondayBot
// Used by other bots (e.g. DailyReportBot) to post content to Monday.com

import express from 'express';
import { addUpdate } from '../services/mondayApi.js';
import { getMondayItemIdFromThread } from '../services/threadMapper.js';

const router = express.Router();
router.use(express.json());

// Auth middleware — uses same SCHEDULER_TOKEN as inter-bot auth
function auth(req, res, next) {
  const token = process.env.SCHEDULER_TOKEN;
  if (!token) return next();
  if (req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(auth);

/**
 * POST /api/forward-to-monday
 * Posts a text update to a Monday.com item.
 * Body: { itemId: string, body: string }
 *   OR: { threadId: string, body: string } (looks up itemId from thread mapping)
 */
router.post('/forward-to-monday', async (req, res) => {
  const start = Date.now();
  try {
    let { itemId, threadId, body } = req.body;

    if (!body) {
      return res.status(400).json({ success: false, error: 'body is required' });
    }

    // Resolve itemId from threadId if needed
    if (!itemId && threadId) {
      itemId = await getMondayItemIdFromThread(threadId);
      if (!itemId) {
        return res.status(404).json({ success: false, error: `No Monday.com item mapped for thread ${threadId}` });
      }
    }

    if (!itemId) {
      return res.status(400).json({ success: false, error: 'itemId or threadId is required' });
    }

    const result = await addUpdate(itemId, body);
    res.json({
      success: true,
      itemId,
      updateId: result?.id,
      durationMs: Date.now() - start
    });
  } catch (error) {
    console.error('[API] forward-to-monday error:', error);
    res.status(500).json({ success: false, error: error.message, durationMs: Date.now() - start });
  }
});

/**
 * GET /api/lookup-monday-id/:threadId
 * Looks up the Monday.com item ID for a Discord thread.
 */
router.get('/lookup-monday-id/:threadId', async (req, res) => {
  try {
    const itemId = await getMondayItemIdFromThread(req.params.threadId);
    if (!itemId) {
      return res.status(404).json({ success: false, error: 'No mapping found' });
    }
    res.json({ success: true, itemId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
