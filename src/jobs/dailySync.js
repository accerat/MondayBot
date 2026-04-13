// src/jobs/dailySync.js
// Daily auto-sync job - creates threads for Monday items missing them

import cron from 'node-cron';
import { getESSProjects, getItem } from '../services/mondayApi.js';
import { AttachmentBuilder } from 'discord.js';
import { getThreadId, mapThread, findExistingThreadByName } from '../services/threadMapper.js';
import { incrementStat } from './weeklySummary.js';
import { buildFieldsFromItemDetails, formatPinnedPost, pinStarterMessage } from '../services/pinnedPostFormatter.js';

const TZ = process.env.TIMEZONE || 'America/Chicago';

/**
 * Initialize daily sync cron job
 * @param {Client} client - Discord client
 */
export function initializeDailySync(client) {
  if (process.env.SCHEDULER_MODE === 'external') {
    console.log('[daily-sync] Skipping local cron (SCHEDULER_MODE=external)');
    return;
  }
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
  // getESSProjects() now only returns items NOT in "MLB non-ESS jobs" group
  // These are all ESS projects by definition
  const allProjects = await getESSProjects();

  const created = [];
  const errors = [];

  for (const project of allProjects) {
    try {
      // Check if already has a thread
      const existingMapping = await getThreadId(project.mondayItemId);
      if (existingMapping) continue;

      // Route based on group: non-ESS → default channel, ESS → ESS channel
      // Branch column can override for ESS items that should go to OPD
      const branch = project.rawColumns?.dropdown_mm07kqx?.text || '';
      const effectiveBranch = project.isNonESS ? 'default' :
                              branch.toLowerCase() === 'opd' ? 'opd' : 'ess';

      // Create thread
      const threadId = await createThreadForProject(project, effectiveBranch, client);
      if (threadId) {
        created.push({ name: project.name, threadId, branch: effectiveBranch });
        await incrementStat('threadsCreated');
      }
    } catch (error) {
      console.error(`[daily-sync] Error processing ${project.name}:`, error.message);
      errors.push({ name: project.name, error: error.message });
    }
  }

  // Post summary to flag channel if anything happened
  if (created.length > 0 || errors.length > 0) {
    await postDailySyncReport(client, flagChannelId, { created, errors });
  } else {
    console.log('[daily-sync] No new items to sync');
  }

  console.log(`[daily-sync] Complete - Created: ${created.length}, Errors: ${errors.length}`);
}

/**
 * Create a Discord thread for a project
 * @param {object} project - Project data
 * @param {string} branch - 'ess', 'opd', or 'default'
 * @param {Client} client - Discord client
 */
async function createThreadForProject(project, branch, client) {
  const channelId = branch === 'opd' ? process.env.OPD_CHANNEL_ID :
                    branch === 'default' ? process.env.DEFAULT_CHANNEL_ID :
                    process.env.ESS_CHANNEL_ID;

  if (!channelId) {
    console.error(`[daily-sync] No channel ID for branch: ${branch}`);
    return null;
  }

  const forumChannel = await client.channels.fetch(channelId);
  if (!forumChannel || !forumChannel.isThreadOnly()) {
    console.error(`[daily-sync] Channel ${channelId} not found or not a forum`);
    return null;
  }

  // Check if a thread with this name already exists (prevents duplicates)
  const threadName = project.name;
  const existingThreadId = await findExistingThreadByName(forumChannel, threadName, project.mondayItemId);
  if (existingThreadId) {
    console.log(`[daily-sync] Thread already exists for "${threadName}" (${existingThreadId}), mapped instead of creating duplicate`);
    return existingThreadId;
  }

  // Fetch full item details for the rich pinned post
  let message;
  try {
    const itemDetails = await getItem(project.mondayItemId);
    const { fields, values } = buildFieldsFromItemDetails(itemDetails);
    message = formatPinnedPost(threadName, project.mondayItemId, fields, values);
  } catch (error) {
    console.error(`[daily-sync] Could not fetch item details for rich post, using basic format:`, error.message);
    message = `📌 **PROJECT INFO**\n\n**${threadName}**\nMonday.com ID: \`${project.mondayItemId}\`\nBoard: ${project.boardName}\n`;
    if (project.city || project.state) message += `**Location:** ${project.city}, ${project.state}\n`;
    if (project.sageNumber) message += `**Sage #:** ${project.sageNumber}\n`;
    message += `\n*Auto-synced by daily job*`;
  }

  // Create thread
  const thread = await forumChannel.threads.create({
    name: threadName,
    message: { content: message },
  });

  console.log(`[daily-sync] Created thread for "${threadName}" (${thread.id})`);

  // Map it
  await mapThread(project.mondayItemId, thread.id, threadName);

  // Pin the starter message
  await pinStarterMessage(thread, project.mondayItemId);

  // Post any existing files (permits, etc.)
  try {
    const itemDetails = await getItem(project.mondayItemId);
    const fileColumns = (itemDetails?.column_values || []).filter(c => c.type === 'file' && c.value);
    if (fileColumns.length > 0) {
      const assetsResult = await fetch('https://api.monday.com/v2', {
        method: 'POST',
        headers: { 'Authorization': process.env.MONDAY_API_TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-10' },
        body: JSON.stringify({ query: `{ items(ids: [${project.mondayItemId}]) { assets { id name url public_url file_extension } } }` })
      }).then(r => r.json());
      const assets = (assetsResult.data?.items?.[0]?.assets || []).filter(a => /\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(a.name));
      if (assets.length > 0) {
        const files = [];
        for (const asset of assets.slice(0, 10)) {
          try {
            const res = await fetch(asset.public_url || asset.url);
            if (res.ok) files.push(new AttachmentBuilder(Buffer.from(await res.arrayBuffer()), { name: asset.name }));
          } catch {}
        }
        if (files.length > 0) {
          await thread.send({ content: `📎 **Existing files** — ${files.length} file(s)`, files });
        }
      }
    }
  } catch (err) {
    console.error(`[daily-sync] Error posting existing files for ${project.name}:`, err.message);
  }

  return thread.id;
}

/**
 * Post daily sync report to flag channel
 */
async function postDailySyncReport(client, channelId, { created, errors }) {
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  let message = `**Daily Sync Report**\n\n`;

  if (created.length > 0) {
    message += `**Threads Created:** ${created.length}\n`;
    for (const item of created.slice(0, 10)) {
      message += `- ${item.name} (${item.branch.toUpperCase()})\n`;
    }
    if (created.length > 10) {
      message += `- ...and ${created.length - 10} more\n`;
    }
    message += '\n';
  }

  if (errors.length > 0) {
    message += `**Errors:** ${errors.length}\n`;
    for (const item of errors.slice(0, 5)) {
      message += `- ${item.name}: ${item.error}\n`;
    }
  }

  if (created.length === 0 && errors.length === 0) {
    message += `All projects already synced.`;
  }

  await channel.send(message);
  console.log('[daily-sync] Posted report to flag channel');
}
