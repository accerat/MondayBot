// src/services/mondayWebhook.js
// Handles incoming webhooks from Monday.com and posts to Discord

import { getThreadId, findThreadByMondayId, mapThread } from './threadMapper.js';
import { getItem } from './mondayApi.js';

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
    'UHC Comments': 'Becka Notes'
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
 * Handle new update/comment
 */
async function handleNewUpdate(thread, event) {
  const author = event.userName || event.user?.name || 'Someone';
  const updateText = event.textBody || event.body || event.text_body || 'No content';

  const message = `💬 **New Comment from ${author}**\n` +
                  `>>> ${updateText}`;

  await thread.send(message);
  console.log(`[Webhook] Posted comment to thread ${thread.id}: "${updateText.substring(0, 50)}..."`);
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
 * Check if an item should be synced to Discord based on column values
 * Only sync if:
 * - "Mason/Carp" column contains "team mlb" (case insensitive)
 * - OR "Survey Assignment" column contains "nick phelps" (case insensitive)
 */
async function checkIfItemShouldSync(itemId, item = null) {
  try {
    // If item not provided, fetch it
    if (!item) {
      item = await getItem(itemId);
    }

    if (!item || !item.column_values) {
      console.log(`[Webhook] Could not get item details for ${itemId}`);
      return false;
    }

    // Find the relevant columns
    const masonCarpColumn = item.column_values.find(col =>
      col.title && col.title.toLowerCase().includes('mason') && col.title.toLowerCase().includes('carp')
    );

    const surveyAssignmentColumn = item.column_values.find(col =>
      col.title && col.title.toLowerCase() === 'survey assignment'
    );

    // Check if "Mason/Carp" contains "team mlb"
    if (masonCarpColumn) {
      const masonCarpValue = (masonCarpColumn.text || '').toLowerCase();
      if (masonCarpValue.includes('team mlb')) {
        console.log(`[Webhook] Item ${itemId} matches: Mason/Carp = "${masonCarpColumn.text}"`);
        return true;
      }
    }

    // Check if "Survey Assignment" contains "nick phelps"
    if (surveyAssignmentColumn) {
      const surveyValue = (surveyAssignmentColumn.text || '').toLowerCase();
      if (surveyValue.includes('nick phelps')) {
        console.log(`[Webhook] Item ${itemId} matches: Survey Assignment = "${surveyAssignmentColumn.text}"`);
        return true;
      }
    }

    console.log(`[Webhook] Item ${itemId} does not match sync criteria`);
    return false;
  } catch (error) {
    console.error(`[Webhook] Error checking sync criteria for item ${itemId}:`, error);
    // On error, default to syncing (fail open)
    return true;
  }
}

/**
 * Create a new Discord thread for a Monday.com item
 */
async function createDiscordThread(itemId, itemDetails, discordClient) {
  try {
    const forumChannelId = process.env.PROJECTS_CATEGORY_ID;
    if (!forumChannelId) {
      console.error('[Webhook] PROJECTS_CATEGORY_ID not configured');
      return null;
    }

    // Get the forum channel
    const forumChannel = await discordClient.channels.fetch(forumChannelId);
    if (!forumChannel || !forumChannel.isThreadOnly()) {
      console.error(`[Webhook] Forum channel ${forumChannelId} not found or not a forum`);
      return null;
    }

    // Create the thread
    const threadName = itemDetails.name || `Monday Item ${itemId}`;
    const thread = await forumChannel.threads.create({
      name: threadName,
      message: {
        content: `🆕 **New Project Synced from Monday.com**\n\n` +
                 `Project: **${threadName}**\n` +
                 `Monday.com ID: \`${itemId}\`\n\n` +
                 `This thread is now synced with Monday.com. Updates here and there will be reflected in both places.`
      },
    });

    console.log(`[Webhook] Created Discord thread ${thread.id} for Monday item ${itemId}`);

    // Map the thread
    await mapThread(itemId, thread.id, threadName);

    return thread.id;
  } catch (error) {
    console.error(`[Webhook] Error creating Discord thread for item ${itemId}:`, error);
    return null;
  }
}
