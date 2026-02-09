// src/services/mondayWebhook.js
// Handles incoming webhooks from Monday.com and posts to Discord

import { getThreadId, findThreadByMondayId, mapThread } from './threadMapper.js';
import { getItem, getUserName } from './mondayApi.js';
import { shouldFlagItem, markItemFlagged, markItemResolved } from './flagTracker.js';
import { incrementStat } from '../jobs/weeklySummary.js';

/**
 * Handle Monday.com webhook
 */
export async function handleMondayWebhook(payload, discordClient) {
  try {
    console.log('[Webhook] Processing Monday.com webhook:', payload.event?.type);

    const event = payload.event;
    if (!event) {
      console.log('[Webhook] No event in payload, ignoring');
      return;
    }

    // Extract item ID from the webhook
    const itemId = event.pulseId || event.itemId;
    if (!itemId) {
      console.log('[Webhook] No item ID in webhook, ignoring');
      return;
    }

    // Check if this item should be synced to Discord
    const itemDetails = await getItem(itemId);
    const shouldSync = await checkIfItemShouldSync(itemId, itemDetails);
    if (!shouldSync) {
      console.log(`[Webhook] Item ${itemId} does not meet sync criteria, skipping`);
      return;
    }

    // Find the Discord thread for this Monday item
    let threadId = await getThreadId(itemId);

    // If not mapped yet, try to find it or create it
    if (!threadId) {
      console.log(`[Webhook] Thread not mapped for Monday item ${itemId}, searching...`);
      threadId = await findThreadByMondayId(itemId, discordClient);

      if (threadId) {
        // Found existing thread, map it
        await mapThread(itemId, threadId, itemDetails.name || 'Unknown Project');
      } else {
        // No thread found - create a new one!
        console.log(`[Webhook] Creating new Discord thread for Monday item ${itemId}`);
        threadId = await createDiscordThread(itemId, itemDetails, discordClient);

        if (!threadId) {
          console.log(`[Webhook] Failed to create Discord thread for Monday item ${itemId}`);
          return;
        }
      }
    } else {
      threadId = threadId.threadId; // Extract from mapping object
    }

    // Get the thread
    const thread = await discordClient.channels.fetch(threadId);
    if (!thread) {
      console.log(`[Webhook] Could not fetch Discord thread ${threadId}`);
      return;
    }

    // Handle different event types
    switch (event.type) {
      case 'update_column_value':
        // Special handling for Branch column - may create thread for previously flagged items
        const columnTitle = event.columnTitle || event.column_title || '';
        if (columnTitle.toLowerCase() === 'branch') {
          const newThreadId = await handleBranchUpdate(itemId, itemDetails, discordClient);
          if (newThreadId) {
            // Thread was just created, no need to post update
            return;
          }
        }
        await handleColumnUpdate(thread, event);
        break;

      case 'create_update':
        await handleNewUpdate(thread, event);
        break;

      case 'create_file':
        await handleFileUpload(thread, event);
        break;

      case 'change_status_column_value':
        await handleStatusChange(thread, event);
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    throw error;
  }
}

/**
 * Handle column value update
 */
async function handleColumnUpdate(thread, event) {
  const columnTitle = event.columnTitle || event.column_title || 'Field';
  const newValue = event.value?.label?.text || event.value?.text || event.textValue || 'Updated';
  const previousValue = event.previousValue?.label?.text || event.previousValue?.text || 'N/A';

  // Map column names to friendly display names
  const columnMapping = {
    'Start Date': 'WAL Start Date',
    'End Date': 'WAL End Date',
    'Location': 'Location of Store',
    'Contact': 'Walmart Store Contact Info',
    'Material Quantities': 'Materials',
    'CTL Notes': 'CTL Inspectors',
    'Survey Assignment': 'Surveyor',
    'Ceremony Actual POD': '⚠️ IMPORTANT END BY DATE',
    'Material Notes': 'Material Updates',
    'UHC Comments': 'Becka Notes',
    'Branch': 'Branch'
  };

  const displayName = columnMapping[columnTitle] || columnTitle;

  // Special handling for Ceremony Actual POD - make it very visible
  const isUrgentDeadline = columnTitle === 'Ceremony Actual POD';
  const emoji = isUrgentDeadline ? '🚨' : '🔄';

  let message = `${emoji} **${displayName} Changed**\n`;

  if (previousValue !== 'N/A' && previousValue !== newValue) {
    message += `~~${previousValue}~~ → **${newValue}**\n`;
  } else {
    message += `**${newValue}**\n`;
  }

  if (isUrgentDeadline) {
    message += `\n⚠️ **URGENT: This is the final deadline date!** ⚠️\n`;
  }

  message += `_Updated by ${event.userId || 'Unknown'}_`;

  await thread.send(message);
  console.log(`[Webhook] Posted column update to thread ${thread.id}`);
}

/**
 * Handle Branch column update specially - may need to create thread for previously flagged items
 */
async function handleBranchUpdate(itemId, itemDetails, discordClient) {
  // Check if thread already exists
  const existingThread = await getThreadId(itemId);
  if (existingThread) {
    // Thread exists, normal column update will handle it
    return null;
  }

  // No thread yet - check if branch is now valid
  const branchInfo = getBranchChannel(itemDetails);

  if (!branchInfo.flagged) {
    // Branch is now valid! Create the thread
    console.log(`[Webhook] Branch updated to valid value for item ${itemId}, creating thread now`);
    const threadId = await createDiscordThread(itemId, itemDetails, discordClient);

    // Post resolution notice to flag channel
    if (threadId) {
      await postFlagResolution(itemId, itemDetails, threadId, discordClient);
    }

    return threadId;
  }

  // Still flagged - re-flag with updated reason
  await flagBranchIssue(itemId, itemDetails, branchInfo.reason, discordClient);
  return null;
}

/**
 * Post resolution notice to flag channel when a flagged item is fixed
 */
async function postFlagResolution(itemId, itemDetails, threadId, discordClient) {
  const flagChannelId = process.env.FLAG_CHANNEL_ID;
  if (!flagChannelId) return;

  try {
    const channel = await discordClient.channels.fetch(flagChannelId);
    if (!channel) return;

    const itemName = itemDetails.name || `Item ${itemId}`;
    const message = `**Resolved** - Item "${itemName}" (ID: \`${itemId}\`) now has a valid branch. Thread created: <#${threadId}>`;

    await channel.send(message);
    console.log(`[Webhook] Posted flag resolution notice for item ${itemId}`);

    // Clear from tracking and track stat
    await markItemResolved(itemId);
    await incrementStat('flagsResolved');
  } catch (error) {
    console.error(`[Webhook] Error posting flag resolution:`, error);
  }
}

/**
 * Handle new update/comment
 */
async function handleNewUpdate(thread, event) {
  // Get author name - first try direct fields, then look up by userId
  let author = event.userName ||
               event.user_name ||
               event.user?.name ||
               event.creator?.name ||
               event.creatorName ||
               event.creator_name;

  // If no name found but we have userId, look it up
  if (!author && event.userId) {
    author = await getUserName(event.userId);
  }

  // Final fallback
  if (!author) {
    author = 'Someone';
  }

  const updateText = event.textBody || event.body || event.text_body || 'No content';

  const message = `💬 **New Comment from ${author}**\n` +
                  `>>> ${updateText}`;

  await thread.send(message);
  console.log(`[Webhook] Posted comment to thread ${thread.id}: "${updateText.substring(0, 50)}..." from ${author}`);
}

/**
 * Handle file upload
 */
async function handleFileUpload(thread, event) {
  const fileName = event.fileName || 'File';
  const fileUrl = event.fileUrl || event.url;

  let message = `📎 **File Uploaded: ${fileName}**\n`;
  if (fileUrl) {
    message += `[View File](${fileUrl})`;
  }

  await thread.send(message);
  console.log(`[Webhook] Posted file upload to thread ${thread.id}`);
}

/**
 * Handle status change
 */
async function handleStatusChange(thread, event) {
  const statusLabel = event.value?.label?.text || event.value?.text || 'Unknown';
  const statusColor = event.value?.label?.color || '';

  const emoji = getStatusEmoji(statusLabel);
  const message = `${emoji} **Status Changed: ${statusLabel}**`;

  await thread.send(message);
  console.log(`[Webhook] Posted status change to thread ${thread.id}`);

  // Auto-archive on complete
  if (statusLabel.toLowerCase().includes('complete') ||
      statusLabel.toLowerCase().includes('done')) {
    try {
      await thread.send(`*Thread archived - project marked complete*`);
      await thread.setArchived(true);
      console.log(`[Webhook] Archived thread ${thread.id} - status: ${statusLabel}`);
    } catch (error) {
      console.error(`[Webhook] Failed to archive thread:`, error);
    }
  }
}

/**
 * Get emoji for status
 */
function getStatusEmoji(status) {
  const statusLower = status.toLowerCase();

  if (statusLower.includes('complete') || statusLower.includes('done')) return '✅';
  if (statusLower.includes('progress') || statusLower.includes('working')) return '🔄';
  if (statusLower.includes('stuck') || statusLower.includes('blocked')) return '🚫';
  if (statusLower.includes('review')) return '👀';
  if (statusLower.includes('plan')) return '📋';

  return '📌';
}

/**
 * Check if an item should be synced to Discord
 * Now syncs ALL items (no filtering by Mason/Carp or Survey Assignment)
 */
async function checkIfItemShouldSync(itemId, item = null) {
  // Always sync all items
  return true;
}

/**
 * Determine the target Discord channel based on the Branch column value.
 * Returns { channelId, flagged, values, reason } where flagged=true means item needs attention.
 *
 * Flagged cases (no thread created):
 * - Empty/missing branch value
 * - Multiple branches selected
 * - Unrecognized branch value (not ESS or OPD)
 */
function getBranchChannel(itemDetails) {
  const branchCol = itemDetails.column_values?.find(col =>
    col.title && col.title.toLowerCase() === 'branch'
  );

  if (!branchCol || !branchCol.text || branchCol.text.trim() === '') {
    // No branch set - flag it
    return { channelId: null, flagged: true, values: [], reason: 'No branch selected' };
  }

  // Monday dropdown text is comma-separated when multiple values are selected
  const values = branchCol.text.split(',').map(v => v.trim()).filter(Boolean);

  if (values.length > 1) {
    return { channelId: null, flagged: true, values, reason: 'Multiple branches selected' };
  }

  const branch = values[0].toLowerCase();
  if (branch === 'ess') {
    return { channelId: process.env.ESS_CHANNEL_ID, flagged: false, values, reason: null };
  } else if (branch === 'opd') {
    return { channelId: process.env.OPD_CHANNEL_ID, flagged: false, values, reason: null };
  } else {
    // Unrecognized branch value - flag it
    return { channelId: null, flagged: true, values, reason: `Unrecognized branch: "${values[0]}"` };
  }
}

/**
 * Flag an item that needs branch attention to the MLB office channel.
 * Reasons: empty branch, multiple branches, unrecognized branch value
 */
async function flagBranchIssue(itemId, itemDetails, reason, discordClient) {
  try {
    // Check if already flagged for same reason (prevent duplicates)
    if (!await shouldFlagItem(itemId, reason)) {
      console.log(`[Webhook] Item ${itemId} already flagged for: ${reason}, skipping`);
      return;
    }

    const flagChannelId = process.env.FLAG_CHANNEL_ID;
    if (!flagChannelId) {
      console.error('[Webhook] FLAG_CHANNEL_ID not configured');
      return;
    }

    const channel = await discordClient.channels.fetch(flagChannelId);
    if (!channel) {
      console.error(`[Webhook] Flag channel ${flagChannelId} not found`);
      return;
    }

    const branchCol = itemDetails.column_values?.find(col =>
      col.title && col.title.toLowerCase() === 'branch'
    );
    const branchValues = branchCol?.text || '(empty)';
    const itemName = itemDetails.name || `Item ${itemId}`;

    const message = `**Branch Issue** - Item "${itemName}" (ID: \`${itemId}\`)\n**Reason:** ${reason}\n**Current Branch Value:** ${branchValues}\n\nPlease set a valid branch (ESS or OPD) in Monday.com. The Discord thread will be created automatically once fixed.`;

    await channel.send(message);
    console.log(`[Webhook] Flagged item ${itemId}: ${reason}`);

    // Track that we flagged it
    await markItemFlagged(itemId, itemName, reason);
    await incrementStat('itemsFlagged');
  } catch (error) {
    console.error(`[Webhook] Error flagging item ${itemId}:`, error);
  }
}

/**
 * Create a new Discord thread for a Monday.com item
 */
async function createDiscordThread(itemId, itemDetails, discordClient) {
  try {
    // Determine target channel based on Branch column
    const branchInfo = getBranchChannel(itemDetails);

    if (branchInfo.flagged) {
      console.log(`[Webhook] Item ${itemId} flagged: ${branchInfo.reason}`);
      await flagBranchIssue(itemId, itemDetails, branchInfo.reason, discordClient);
      return null;
    }

    const forumChannelId = branchInfo.channelId;
    if (!forumChannelId) {
      console.error('[Webhook] No channel ID resolved for item branch');
      return null;
    }

    // Get the forum channel
    const forumChannel = await discordClient.channels.fetch(forumChannelId);
    if (!forumChannel || !forumChannel.isThreadOnly()) {
      console.error(`[Webhook] Forum channel ${forumChannelId} not found or not a forum`);
      return null;
    }

    // Extract key fields from item details
    const fields = {};
    if (itemDetails.column_values) {
      itemDetails.column_values.forEach(col => {
        fields[col.title] = col.text || 'Not set';
      });
    }

    // Build initial message with all key fields
    const threadName = itemDetails.name || `Monday Item ${itemId}`;
    let message = `🆕 **New Project Synced from Monday.com**\n\n`;
    message += `**${threadName}**\n`;
    message += `Monday.com ID: \`${itemId}\`\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Add key project details
    if (fields['Start Date'] || fields['End Date']) {
      message += `📅 **WAL Window:** ${fields['Start Date'] || 'TBD'} → ${fields['End Date'] || 'TBD'}\n`;
    }

    if (fields['Ceremony Actual POD']) {
      message += `🚨 **IMPORTANT END BY DATE:** ${fields['Ceremony Actual POD']}\n`;
      message += `⚠️ **This is the final deadline!** ⚠️\n`;
    }

    if (fields['Location']) {
      message += `📍 **Location:** ${fields['Location']}\n`;
    }

    if (fields['Contact']) {
      message += `📞 **Walmart Contact:** ${fields['Contact']}\n`;
    }

    if (fields['Survey Assignment']) {
      message += `📋 **Surveyor:** ${fields['Survey Assignment']}\n`;
    }

    if (fields['CTL Notes']) {
      message += `🔍 **CTL Inspectors:** ${fields['CTL Notes']}\n`;
    }

    if (fields['Material Quantities']) {
      message += `📦 **Materials:** ${fields['Material Quantities']}\n`;
    }

    if (fields['Material Notes']) {
      message += `📝 **Material Updates:** ${fields['Material Notes']}\n`;
    }

    if (fields['UHC Comments']) {
      message += `💬 **Becka Notes:** ${fields['UHC Comments']}\n`;
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `\n✅ This thread is now synced with Monday.com. Updates here and there will be reflected in both places.`;

    // Create the thread
    const thread = await forumChannel.threads.create({
      name: threadName,
      message: { content: message },
    });

    console.log(`[Webhook] Created Discord thread ${thread.id} for Monday item ${itemId}`);

    // Map the thread
    await mapThread(itemId, thread.id, threadName);

    // Track stat
    await incrementStat('threadsCreated');

    return thread.id;
  } catch (error) {
    console.error(`[Webhook] Error creating Discord thread for item ${itemId}:`, error);
    return null;
  }
}
