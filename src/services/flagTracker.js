// src/services/flagTracker.js
// Tracks flagged items to prevent duplicate flag messages

import fs from 'fs/promises';
import path from 'path';

const FLAG_TRACKING_FILE = path.join(process.cwd(), 'data', 'flagged-items.json');

async function loadFlaggedItems() {
  try {
    const data = await fs.readFile(FLAG_TRACKING_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return { items: {} };
    throw error;
  }
}

async function saveFlaggedItems(data) {
  await fs.mkdir(path.dirname(FLAG_TRACKING_FILE), { recursive: true });
  await fs.writeFile(FLAG_TRACKING_FILE, JSON.stringify(data, null, 2));
}

/**
 * Check if an item should be flagged (not already flagged for same reason)
 * @param {string} itemId - Monday.com item ID
 * @param {string} reason - Flag reason
 * @returns {Promise<boolean>} True if should flag, false if already flagged for same reason
 */
export async function shouldFlagItem(itemId, reason) {
  const data = await loadFlaggedItems();
  const existing = data.items[itemId];

  if (existing && existing.reason === reason) {
    // Already flagged for same reason - don't spam
    return false;
  }

  return true;
}

/**
 * Mark an item as flagged
 * @param {string} itemId - Monday.com item ID
 * @param {string} itemName - Item name for reference
 * @param {string} reason - Flag reason
 */
export async function markItemFlagged(itemId, itemName, reason) {
  const data = await loadFlaggedItems();
  data.items[itemId] = {
    itemName,
    reason,
    flaggedAt: new Date().toISOString()
  };
  await saveFlaggedItems(data);
}

/**
 * Mark an item as resolved (remove from tracking)
 * @param {string} itemId - Monday.com item ID
 */
export async function markItemResolved(itemId) {
  const data = await loadFlaggedItems();
  delete data.items[itemId];
  await saveFlaggedItems(data);
}

/**
 * Get all currently flagged items
 * @returns {Promise<object>} Flagged items data
 */
export async function getFlaggedItems() {
  const data = await loadFlaggedItems();
  return data.items;
}
