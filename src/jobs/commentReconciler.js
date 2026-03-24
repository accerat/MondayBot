// src/jobs/commentReconciler.js
// Nightly job to catch missed Monday.com comment webhooks.
// Runs at midnight CT — fetches the last 24h of Monday updates for all mapped items,
// checks if they were posted to Discord, and posts any that were missed.

import cron from 'node-cron';
import { getAllMappings } from '../services/threadMapper.js';
import { getItemUpdates } from '../services/mondayApi.js';
import { getDiscordUser } from '../services/crewMapping.js';
import { getItem } from '../services/mondayApi.js';
import { updateAllPinnedPosts } from '../services/projectSyncOrchestrator.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const TZ = process.env.TIMEZONE || 'America/Chicago';
const OPS_LEADERSHIP_ID = '1411793485799096490';

// How far back to look (25 hours to ensure no gaps around midnight)
const LOOKBACK_MS = 25 * 60 * 60 * 1000;

/**
 * Initialize the comment reconciler cron job
 */
export function initializeCommentReconciler(client) {
  if (process.env.SCHEDULER_MODE === 'external') {
    console.log('[comment-reconciler] Skipping local cron (SCHEDULER_MODE=external)');
    return;
  }
  cron.schedule('0 0 * * *', async () => {
    console.log('[nightly-sync] Running nightly reconciliation...');
    try {
      await reconcileComments(client);
    } catch (error) {
      console.error('[nightly-sync] Comment reconciler failed:', error);
    }

    console.log('[nightly-sync] Refreshing all pinned posts...');
    try {
      const result = await updateAllPinnedPosts(client);
      console.log(`[nightly-sync] Pinned post refresh: ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`);
    } catch (error) {
      console.error('[nightly-sync] Pinned post refresh failed:', error);
    }
  }, { timezone: TZ });

  console.log('[comment-reconciler] Initialized - runs daily at midnight CT');
}

/**
 * Run the comment reconciliation
 */
export async function reconcileComments(client) {
  const mappings = await getAllMappings();
  const entries = Object.entries(mappings);
  const cutoff = new Date(Date.now() - LOOKBACK_MS);

  let checked = 0;
  let missed = 0;
  let errors = 0;
  let skipped = 0;

  console.log(`[comment-reconciler] Checking ${entries.length} mapped items for missed comments since ${cutoff.toISOString()}`);

  for (const [mondayItemId, data] of entries) {
    const threadId = data.threadId || data;

    try {
      // Fetch recent updates from Monday
      const updates = await getItemUpdates(mondayItemId, 10);

      // Filter to updates in the last 24h
      const recentUpdates = updates.filter(u => new Date(u.created_at) > cutoff);

      if (recentUpdates.length === 0) {
        checked++;
        continue;
      }

      // Fetch the Discord thread
      let thread;
      try {
        thread = await client.channels.fetch(threadId);
      } catch (err) {
        if (err.code === 10003) {
          // Unknown Channel — thread was deleted, skip it
          skipped++;
          continue;
        }
        throw err;
      }

      if (!thread) {
        skipped++;
        continue;
      }

      // Fetch recent bot messages from the thread (last 50)
      const recentMessages = await thread.messages.fetch({ limit: 50 });
      const botMessages = recentMessages.filter(m => m.author.id === client.user.id);
      const botMessageTexts = botMessages.map(m => m.content);

      // Check each Monday update against Discord messages
      for (const update of recentUpdates) {
        const authorName = update.creator?.name || 'Someone';
        const updateText = update.text_body || '';

        if (!updateText.trim()) continue;

        // Skip updates posted by the bot itself (Discord replies forwarded to Monday)
        if (updateText.includes('(Discord):')) continue;

        // Check if this update's text appears in any bot message
        // Use first 40 chars of the update text as a fingerprint
        const fingerprint = updateText.substring(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const alreadyPosted = botMessageTexts.some(msg => msg.includes(fingerprint));

        if (!alreadyPosted) {
          console.log(`[comment-reconciler] Missed comment found: "${updateText.substring(0, 60)}..." from ${authorName} on item ${mondayItemId}`);

          // Post the missed comment using the same format as the webhook handler
          await postMissedComment(thread, mondayItemId, update);
          missed++;

          // Rate limit
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      checked++;

      // Rate limit between items
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`[comment-reconciler] Error checking item ${mondayItemId}:`, error.message);
      errors++;
    }
  }

  const summary = `[comment-reconciler] Complete — Checked: ${checked}, Missed comments posted: ${missed}, Skipped: ${skipped}, Errors: ${errors}`;
  console.log(summary);

  // Post report to flag channel if any comments were missed
  if (missed > 0) {
    try {
      const flagChannel = await client.channels.fetch(process.env.FLAG_CHANNEL_ID);
      if (flagChannel) {
        await flagChannel.send(`**Nightly Comment Reconciler**\nRecovered **${missed}** missed comment(s) from Monday.com.\nChecked ${checked} items, ${errors} errors.`);
      }
    } catch (err) {
      console.error('[comment-reconciler] Could not post report:', err.message);
    }
  }

  return { checked, missed, skipped, errors };
}

/**
 * Post a missed comment to a Discord thread, matching the webhook handler format
 */
async function postMissedComment(thread, mondayItemId, update) {
  const authorName = update.creator?.name || 'Someone';
  const updateText = update.text_body || 'No content';

  // Build mention string — look up foreman from crew mapping
  let mentions = '';
  let crewWarning = '';
  try {
    const itemDetails = await getItem(mondayItemId);
    const crewCol = itemDetails?.column_values?.find(c =>
      (c.title || '').toLowerCase() === 'crew'
    );
    const crewName = crewCol?.text;
    if (crewName) {
      const foremanId = getDiscordUser(crewName);
      if (foremanId) {
        mentions += `<@${foremanId}> `;
      } else {
        crewWarning = `\n⚠️ _No Discord link for crew "${crewName}" — foreman was not notified_`;
      }
    } else {
      crewWarning = `\n⚠️ _No crew assigned — foreman was not notified_`;
    }
  } catch (err) {
    console.error('[comment-reconciler] Error looking up foreman:', err.message);
  }
  mentions += `<@${OPS_LEADERSHIP_ID}>`;

  const replyButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`monday_reply_${mondayItemId}`)
      .setLabel('Reply to Monday.com')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('💬')
  );

  const message = `💬 **New Comment from ${authorName}** _(recovered)_\n` +
                  `>>> ${updateText}\n\n` +
                  mentions + crewWarning;

  await thread.send({ content: message, components: [replyButton] });
  console.log(`[comment-reconciler] Posted recovered comment to thread ${thread.id}`);
}
