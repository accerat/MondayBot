// src/jobs/dailySync.js
// Daily auto-sync job - creates threads for Monday items missing them

import cron from 'node-cron';
import { getESSProjects } from '../services/mondayApi.js';
import { getThreadId, mapThread } from '../services/threadMapper.js';
import { incrementStat } from './weeklySummary.js';

const TZ = process.env.TIMEZONE || 'America/Chicago';

/**
 * Initialize daily sync cron job
 * @param {Client} client - Discord client
 */
export function initializeDailySync(client) {
  // Every day at 7 AM CT (before weekly summary at 8 AM)
  cron.schedule('0 7 * * *', async () => {
    console.log('[daily-sync] Running scheduled job');
    try {
      await runDailySync(client);
    } catch (error) {
      console.error('[daily-sync] Failed:', error);
    }
  }, { timezone: TZ });

  console.log('[daily-sync] Initialized - runs daily at 7 AM CT');
}

/**
 * Run daily sync - find items missing threads and create them
 * @param {Client} client - Discord client
 */
export async function runDailySync(client) {
  const flagChannelId = process.env.FLAG_CHANNEL_ID;

  console.log('[daily-sync] Fetching all Monday.com projects...');
  const allProjects = await getESSProjects();

  const created = [];
  const flagged = [];
  const errors = [];

  for (const project of allProjects) {
    try {
      // Check if already has a thread
      const existingMapping = await getThreadId(project.mondayItemId);
      if (existingMapping) continue;

      // Check branch value
      const branch = project.rawColumns?.dropdown_mm07kqx?.text || '';
      const branchLower = branch.toLowerCase();

      if (branchLower === 'ess' || branchLower === 'opd') {
        // Valid branch - create thread
        const threadId = await createThreadForProject(project, client);
        if (threadId) {
          created.push({ name: project.name, threadId, branch: branchLower });
          await incrementStat('threadsCreated');
        }
      } else {
        // Invalid/missing branch - track for report
        flagged.push({ name: project.name, branch: branch || '(empty)' });
      }
    } catch (error) {
      console.error(`[daily-sync] Error processing ${project.name}:`, error.message);
      errors.push({ name: project.name, error: error.message });
    }
  }

  // Post summary to flag channel if anything happened
  if (created.length > 0 || flagged.length > 0) {
    await postDailySyncReport(client, flagChannelId, { created, flagged, errors });
  } else {
    console.log('[daily-sync] No new items to sync');
  }

  console.log(`[daily-sync] Complete - Created: ${created.length}, Flagged: ${flagged.length}, Errors: ${errors.length}`);
}

/**
 * Create a Discord thread for a project
 */
async function createThreadForProject(project, client) {
  const branch = project.rawColumns?.dropdown_mm07kqx?.text?.toLowerCase() || '';
  const channelId = branch === 'ess' ? process.env.ESS_CHANNEL_ID : process.env.OPD_CHANNEL_ID;

  if (!channelId) {
    console.error(`[daily-sync] No channel ID for branch: ${branch}`);
    return null;
  }

  const forumChannel = await client.channels.fetch(channelId);
  if (!forumChannel || !forumChannel.isThreadOnly()) {
    console.error(`[daily-sync] Channel ${channelId} not found or not a forum`);
    return null;
  }

  // Build thread message
  const threadName = project.name;
  let message = `**New Project Synced from Monday.com**\n\n`;
  message += `**${threadName}**\n`;
  message += `Monday.com ID: \`${project.mondayItemId}\`\n`;
  message += `Board: ${project.boardName}\n\n`;

  if (project.city || project.state) {
    message += `**Location:** ${project.city}, ${project.state}\n`;
  }

  if (project.sageNumber) {
    message += `**Sage #:** ${project.sageNumber}\n`;
  }

  message += `\n*Auto-synced by daily job*`;

  // Create thread
  const thread = await forumChannel.threads.create({
    name: threadName,
    message: { content: message },
  });

  console.log(`[daily-sync] Created thread for "${threadName}" (${thread.id})`);

  // Map it
  await mapThread(project.mondayItemId, thread.id, threadName);

  return thread.id;
}

/**
 * Post daily sync report to flag channel
 */
async function postDailySyncReport(client, channelId, { created, flagged, errors }) {
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  let message = `**Daily Sync Report**\n\n`;

  if (created.length > 0) {
    message += `**Threads Created:** ${created.length}\n`;
    for (const item of created.slice(0, 5)) {
      message += `- ${item.name} (${item.branch.toUpperCase()})\n`;
    }
    if (created.length > 5) {
      message += `- ...and ${created.length - 5} more\n`;
    }
    message += '\n';
  }

  if (flagged.length > 0) {
    message += `**Missing Valid Branch:** ${flagged.length}\n`;
    for (const item of flagged.slice(0, 5)) {
      message += `- ${item.name} (Branch: ${item.branch})\n`;
    }
    if (flagged.length > 5) {
      message += `- ...and ${flagged.length - 5} more\n`;
    }
    message += '\n';
  }

  if (errors.length > 0) {
    message += `**Errors:** ${errors.length}\n`;
    for (const item of errors.slice(0, 3)) {
      message += `- ${item.name}: ${item.error}\n`;
    }
  }

  await channel.send(message);
  console.log('[daily-sync] Posted report to flag channel');
}
