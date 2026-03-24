// src/jobs/weeklySummary.js
// Weekly summary cron job - posts stats every Monday at 8 AM CT

import cron from 'node-cron';
import { getAllMappings } from '../services/threadMapper.js';
import fs from 'fs/promises';
import path from 'path';

const STATS_FILE = path.join(process.cwd(), 'data', 'weekly-stats.json');
const TZ = process.env.TIMEZONE || 'America/Chicago';

/**
 * Initialize weekly summary cron job
 * @param {Client} client - Discord client
 */
export function initializeWeeklySummary(client) {
  if (process.env.SCHEDULER_MODE === 'external') {
    console.log('[weekly-summary] Skipping local cron (SCHEDULER_MODE=external)');
    return;
  }
  cron.schedule('0 8 * * 1', async () => {
    console.log('[weekly-summary] Running scheduled job');
    try {
      await postWeeklySummary(client);
    } catch (error) {
      console.error('[weekly-summary] Failed:', error);
    }
  }, { timezone: TZ });

  console.log('[weekly-summary] Initialized - runs Monday 8 AM CT');
}

/**
 * Post weekly summary to flag channel
 * @param {Client} client - Discord client
 */
export async function postWeeklySummary(client) {
  const channelId = process.env.FLAG_CHANNEL_ID;
  if (!channelId) {
    console.error('[weekly-summary] FLAG_CHANNEL_ID not configured');
    return;
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    console.error('[weekly-summary] Could not fetch channel');
    return;
  }

  // Calculate week range
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Get current stats
  const stats = await getWeeklyStats();

  let message = `**Weekly MondayBot Summary**\n`;
  message += `*${weekAgo.toLocaleDateString()} - ${now.toLocaleDateString()}*\n\n`;
  message += `**Threads Created:** ${stats.threadsCreated}\n`;
  message += `**Items Flagged:** ${stats.itemsFlagged}\n`;
  message += `**Flags Resolved:** ${stats.flagsResolved}\n`;
  message += `**Total Active Mappings:** ${stats.totalMappings}\n`;

  await channel.send(message);
  console.log('[weekly-summary] Posted summary');

  // Reset weekly counters
  await resetWeeklyCounters();
}

/**
 * Increment a stat counter
 * @param {string} statName - Name of the stat to increment (threadsCreated, itemsFlagged, flagsResolved)
 */
export async function incrementStat(statName) {
  const data = await loadStats();
  data.currentWeek[statName] = (data.currentWeek[statName] || 0) + 1;
  await saveStats(data);
}

/**
 * Load stats from disk
 */
async function loadStats() {
  try {
    const content = await fs.readFile(STATS_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return { currentWeek: {} };
  }
}

/**
 * Save stats to disk
 */
async function saveStats(data) {
  await fs.mkdir(path.dirname(STATS_FILE), { recursive: true });
  await fs.writeFile(STATS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get weekly stats summary
 */
async function getWeeklyStats() {
  const data = await loadStats();
  const mappings = await getAllMappings();

  return {
    threadsCreated: data.currentWeek.threadsCreated || 0,
    itemsFlagged: data.currentWeek.itemsFlagged || 0,
    flagsResolved: data.currentWeek.flagsResolved || 0,
    totalMappings: Object.keys(mappings).length
  };
}

/**
 * Reset weekly counters after posting summary
 */
async function resetWeeklyCounters() {
  await saveStats({ currentWeek: {} });
}
