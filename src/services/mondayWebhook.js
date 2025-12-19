// src/services/mondayWebhook.js
// Handles incoming webhooks from Monday.com and posts to Discord

import { getThreadId, findThreadByMondayId, mapThread } from './threadMapper.js';

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

    // Find the Discord thread for this Monday item
    let threadId = await getThreadId(itemId);

    // If not mapped yet, try to find it
    if (!threadId) {
      console.log(`[Webhook] Thread not mapped for Monday item ${itemId}, searching...`);
      threadId = await findThreadByMondayId(itemId, discordClient);

      if (threadId) {
        // Map it for future use
        await mapThread(itemId, threadId, event.pulseName || 'Unknown Project');
      } else {
        console.log(`[Webhook] Could not find Discord thread for Monday item ${itemId}`);
        return;
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

  const message = `🔄 **${columnTitle} Changed**\n` +
                  `~~${previousValue}~~ → **${newValue}**\n` +
                  `_Updated by ${event.userId || 'Unknown'}_`;

  await thread.send(message);
  console.log(`[Webhook] Posted column update to thread ${thread.id}`);
}

/**
 * Handle new update/comment
 */
async function handleNewUpdate(thread, event) {
  const author = event.userName || 'Someone';
  const updateText = event.textBody || event.body || 'No content';

  const message = `💬 **New Comment from ${author}**\n` +
                  `${updateText}`;

  await thread.send(message);
  console.log(`[Webhook] Posted update to thread ${thread.id}`);
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
