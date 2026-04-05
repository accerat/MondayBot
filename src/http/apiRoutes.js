// src/http/apiRoutes.js
// Cross-bot API endpoints for MondayBot
// Used by other bots (e.g. DailyReportBot) to post content to Monday.com

import express from 'express';
import { addUpdate, getItem, uploadFileToUpdate } from '../services/mondayApi.js';
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
 * POST /api/forward-photos-to-monday
 * Creates an update on a Monday.com item and attaches photos to it.
 * Body: { itemId: string, body: string, photos: [{ url, name }] }
 */
router.post('/forward-photos-to-monday', async (req, res) => {
  const start = Date.now();
  try {
    const { itemId, body, photos } = req.body;

    if (!itemId) {
      return res.status(400).json({ success: false, error: 'itemId is required' });
    }
    if (!photos || photos.length === 0) {
      return res.status(400).json({ success: false, error: 'photos array is required' });
    }

    // Create the update first
    const updateBody = body || `📸 ${photos.length} photo(s) uploaded from Discord`;
    const update = await addUpdate(itemId, updateBody);
    const updateId = update?.id;

    if (!updateId) {
      return res.status(500).json({ success: false, error: 'Failed to create Monday.com update' });
    }

    // Upload 3 at a time in parallel for speed
    let uploaded = 0;
    let errors = 0;
    for (let i = 0; i < photos.length; i += 3) {
      const batch = photos.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map((photo, j) =>
          uploadFileToUpdate(updateId, photo.url, photo.name || `photo-${i + j + 1}.jpg`)
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled') uploaded++;
        else { errors++; console.error(`[API] Photo upload failed:`, r.reason?.message); }
      }
    }

    res.json({
      success: true,
      itemId,
      updateId,
      uploaded,
      errors,
      durationMs: Date.now() - start
    });
  } catch (error) {
    console.error('[API] forward-photos-to-monday error:', error);
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

/**
 * GET /api/project-dates/:threadId
 * Returns project timeline/dates for a Discord thread's linked Monday item.
 * Used by LodgingBot to flag lodging requests outside project dates.
 */
router.get('/project-dates/:threadId', async (req, res) => {
  try {
    const itemId = await getMondayItemIdFromThread(req.params.threadId);
    if (!itemId) {
      return res.status(404).json({ success: false, error: 'No mapping found' });
    }

    const item = await getItem(itemId);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Monday item not found' });
    }

    // Extract date fields from column values
    const cols = {};
    for (const col of item.column_values || []) {
      cols[col.title] = { text: col.text, value: col.value ? JSON.parse(col.value) : null };
    }

    // Find timeline column (has from/to)
    let timeline = null;
    for (const col of item.column_values || []) {
      if (col.type === 'timerange' && col.value) {
        const val = JSON.parse(col.value);
        if (val.from && val.to) {
          timeline = { from: val.from, to: val.to };
          break;
        }
      }
    }

    // Find date columns by title pattern
    const getDateByTitle = (pattern) => {
      for (const col of item.column_values || []) {
        if (pattern.test(col.title) && col.text) return col.text;
      }
      return null;
    };

    res.json({
      success: true,
      itemId,
      projectName: item.name,
      timeline,
      uhcCSD: getDateByTitle(/uhc.*csd|uhc.*start/i),
      walCSD: getDateByTitle(/wal.*csd|wal.*start/i),
      endDate: getDateByTitle(/end\s*date/i),
      startDate: getDateByTitle(/start\s*date/i),
    });
  } catch (error) {
    console.error('[API] project-dates error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
