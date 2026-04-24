// src/services/mondayWebhook.js
// Handles incoming webhooks from Monday.com and posts to Discord

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { getThreadId, findThreadByMondayId, findExistingThreadByName, mapThread } from './threadMapper.js';
import { getItem, getUserName, getUpdateAssets } from './mondayApi.js';
import { shouldFlagItem, markItemFlagged, markItemResolved } from './flagTracker.js';
import { incrementStat } from '../jobs/weeklySummary.js';
import { buildFieldsFromItemDetails, formatPinnedPost, pinStarterMessage, updatePinnedPost } from './pinnedPostFormatter.js';
import { getDiscordUser } from './crewMapping.js';

const OPS_LEADERSHIP_ID = '1411793485799096490';

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
        await handleColumnUpdate(thread, event, itemId, itemDetails);
        break;

      case 'create_update':
        await handleNewUpdate(thread, event, itemId, itemDetails);
        break;

      case 'create_file':
        await handleFileUpload(thread, event);
        break;

      case 'change_status_column_value':
        await handleStatusChange(thread, event, itemId, itemDetails);
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
 * Handle column value update — posts update message AND edits the pinned post
 */
async function handleColumnUpdate(thread, event, itemId, itemDetails) {
  const columnTitle = event.columnTitle || event.column_title || 'Field';
  const columnId = event.columnId || event.column_id;
  console.log(`[Webhook] Column update: "${columnTitle}" (${columnId}) for item ${itemId}`);

  // Extract value from webhook event — different column types use different structures
  const newValue = extractColumnValue(event.value, event.textValue) ||
                   getValueFromItemDetails(itemDetails, columnTitle) ||
                   'Updated';
  const previousValue = extractColumnValue(event.previousValue) || 'N/A';

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

  // Resolve user name instead of showing raw ID
  let userName = 'Unknown';
  if (event.userId) {
    userName = await getUserName(event.userId);
  }
  message += `_Updated by ${userName}_`;

  // 1. Post the regular update message
  await thread.send(message);
  console.log(`[Webhook] Posted column update to thread ${thread.id}`);

  // 2. If this looks like a file column (Building Permit, etc.), download and post files
  try {
    // Check if the changed column is a file type by looking at item details
    const freshItem = await getItem(itemId);
    const fileColumns = (freshItem?.column_values || []).filter(c => c.type === 'file' && c.value);

    if (fileColumns.length > 0) {
      // Fetch all assets for the item
      const assetsQuery = `query { items(ids: [${itemId}]) { assets { id name url public_url file_extension } } }`;
      const assetsResult = await fetch('https://api.monday.com/v2', {
        method: 'POST',
        headers: { 'Authorization': process.env.MONDAY_API_TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-10' },
        body: JSON.stringify({ query: assetsQuery })
      }).then(r => r.json());

      const assets = assetsResult.data?.items?.[0]?.assets || [];
      const downloadableAssets = assets.filter(a =>
        /\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(a.name)
      );

      if (downloadableAssets.length > 0) {
        const files = [];
        for (const asset of downloadableAssets.slice(0, 10)) {
          try {
            const res = await fetch(asset.public_url || asset.url);
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer());
              files.push(new AttachmentBuilder(buffer, { name: asset.name }));
            }
          } catch (err) {
            console.error(`[Webhook] Failed to download file ${asset.name}:`, err.message);
          }
        }
        if (files.length > 0) {
          await thread.send({ content: `📎 **${columnTitle}** — ${files.length} file(s) uploaded by ${userName}`, files });
          console.log(`[Webhook] Forwarded ${files.length} file(s) from ${columnTitle} to thread ${thread.id}`);
        }
      }
    }
  } catch (err) {
    console.error(`[Webhook] Error forwarding file column:`, err.message);
  }

  // 3. Edit the pinned post with latest data — re-fetch fresh to ensure mirror columns are current
  await updatePinnedPost(thread, itemId);
}

/**
 * Extract a display value from a Monday.com webhook column value object.
 * Different column types send data in different structures.
 */
function extractColumnValue(val, textValue) {
  if (!val && !textValue) return null;

  // Direct text value from event
  if (textValue) return textValue;

  // Status/label columns: { label: { text: "Done" } }
  if (val?.label?.text) return val.label.text;

  // Text columns: { text: "value" } or plain string in value
  if (val?.text) return val.text;

  // Dropdown columns: { chosenValues: [{ id, name }] }
  if (val?.chosenValues?.length) {
    return val.chosenValues.map(v => v.name).join(', ');
  }

  // Date columns: { date: "2026-03-10" }
  if (val?.date) return val.date;

  // Person columns: { personsAndTeams: [{ id, kind }] }
  if (val?.personsAndTeams?.length) {
    return val.personsAndTeams.map(p => p.name || `User ${p.id}`).join(', ');
  }

  // Link columns: { url: "...", text: "..." }
  if (val?.url) return val.text || val.url;

  // If value is a plain string
  if (typeof val === 'string' && val.trim()) return val.trim();

  return null;
}

/**
 * Get the current value of a column from pre-fetched item details as a fallback.
 */
function getValueFromItemDetails(itemDetails, columnTitle) {
  if (!itemDetails?.column_values) return null;
  const col = itemDetails.column_values.find(c =>
    (c.title || '').toLowerCase() === columnTitle.toLowerCase()
  );
  return col?.text || col?.display_value || null;
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
  try {
    const itemName = itemDetails.name || `Item ${itemId}`;
    console.log(`[Webhook] Flag resolved for item ${itemId} (${itemName}), thread: ${threadId}`);
    await markItemResolved(itemId);
    await incrementStat('flagsResolved');
  } catch (error) {
    console.error(`[Webhook] Error resolving flag:`, error);
  }
}

/**
 * Handle new update/comment — posts to Discord, pings foreman + ops leadership, adds Reply button
 */
async function handleNewUpdate(thread, event, itemId, itemDetails) {
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

  // Skip updates that originated from Discord or were posted by our bots (prevent cycle)
  if (updateText.includes('(Discord):') ||
      updateText.includes('from Discord') ||
      updateText.startsWith('Daily Report —') ||
      updateText.includes('TIMELINE OVERRUN')) {
    console.log(`[Webhook] Skipping bot-originated update (cycle prevention) in thread ${thread.id}`);
    return;
  }

  // Build mention string — ping foreman (from Crew column) + ops leadership
  let mentions = '';
  let crewWarning = '';
  try {
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
    console.error('[Webhook] Error looking up foreman:', err.message);
  }
  mentions += `<@${OPS_LEADERSHIP_ID}>`;

  // Reply button so foremen can respond back to Monday.com
  const replyButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`monday_reply_${itemId}`)
      .setLabel('Reply to Monday.com')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('💬')
  );

  const message = `💬 **New Comment from ${author}**\n` +
                  `>>> ${updateText}\n\n` +
                  mentions + crewWarning;

  await thread.send({ content: message, components: [replyButton] });
  console.log(`[Webhook] Posted comment to thread ${thread.id}: "${updateText.substring(0, 50)}..." from ${author}`);

  // Check for images/files attached to this update
  try {
    const updateId = event.updateId || event.id;
    if (updateId) {
      const assets = await getUpdateAssets(updateId);
      const imageAssets = assets.filter(a =>
        /\.(jpg|jpeg|png|gif|webp)$/i.test(a.name) ||
        ['jpg','jpeg','png','gif','webp'].includes(a.file_extension?.toLowerCase())
      );
      if (imageAssets.length > 0) {
        // Download and forward images as Discord attachments
        const files = [];
        for (const asset of imageAssets.slice(0, 10)) { // max 10
          try {
            const res = await fetch(asset.public_url || asset.url);
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer());
              files.push(new AttachmentBuilder(buffer, { name: asset.name }));
            }
          } catch (err) {
            console.error(`[Webhook] Failed to download asset ${asset.name}:`, err.message);
          }
        }
        if (files.length > 0) {
          await thread.send({ content: `📎 **${files.length} image(s) from ${author}**`, files });
          console.log(`[Webhook] Forwarded ${files.length} image(s) to thread ${thread.id}`);
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] Error forwarding images:', err.message);
  }
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
 * Handle status change — posts update AND edits pinned post
 */
async function handleStatusChange(thread, event, itemId, itemDetails) {
  const statusLabel = event.value?.label?.text || event.value?.text || 'Unknown';
  const statusColor = event.value?.label?.color || '';

  const emoji = getStatusEmoji(statusLabel);
  const message = `${emoji} **Status Changed: ${statusLabel}**`;

  await thread.send(message);
  console.log(`[Webhook] Posted status change to thread ${thread.id}`);

  // Update pinned post with latest data — re-fetch fresh
  await updatePinnedPost(thread, itemId);

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
 * Since items are pre-filtered by group (non-ESS excluded at API level),
 * empty branch defaults to ESS. Only OPD branch routes elsewhere.
 */
function getBranchChannel(itemDetails) {
  // Non-ESS group items go to the default (non-ESS) channel
  const groupTitle = itemDetails.group?.title || '';
  if (groupTitle.toLowerCase().includes('non-ess')) {
    return { channelId: process.env.DEFAULT_CHANNEL_ID, flagged: false, values: [], reason: null };
  }

  const branchCol = itemDetails.column_values?.find(col =>
    col.title && col.title.toLowerCase() === 'branch'
  );

  if (!branchCol || !branchCol.text || branchCol.text.trim() === '') {
    // No branch set - default to ESS
    return { channelId: process.env.ESS_CHANNEL_ID, flagged: false, values: [], reason: null };
  }

  // Monday dropdown text is comma-separated when multiple values are selected
  const values = branchCol.text.split(',').map(v => v.trim()).filter(Boolean);

  if (values.length > 1) {
    // Multiple branches - default to ESS unless only OPD
    const hasOPD = values.some(v => v.toLowerCase() === 'opd');
    const hasESS = values.some(v => v.toLowerCase() === 'ess');
    if (hasOPD && !hasESS) {
      return { channelId: process.env.OPD_CHANNEL_ID, flagged: false, values, reason: null };
    }
    return { channelId: process.env.ESS_CHANNEL_ID, flagged: false, values, reason: null };
  }

  const branch = values[0].toLowerCase();
  if (branch === 'opd') {
    return { channelId: process.env.OPD_CHANNEL_ID, flagged: false, values, reason: null };
  } else {
    // ESS or any other value - default to ESS
    return { channelId: process.env.ESS_CHANNEL_ID, flagged: false, values, reason: null };
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

    const itemName = itemDetails.name || `Item ${itemId}`;
    console.log(`[Webhook] Flagged item ${itemId} (${itemName}): ${reason}`);

    // Track that we flagged it
    await markItemFlagged(itemId, itemName, reason);
    await incrementStat('itemsFlagged');
  } catch (error) {
    console.error(`[Webhook] Error flagging item ${itemId}:`, error);
  }
}

/**
 * Post existing files from file columns (Building Permit, etc.) to a thread.
 * Called after thread creation to ensure pre-existing data is shared.
 */
async function postExistingFiles(thread, itemId, itemDetails) {
  try {
    const fileColumns = (itemDetails.column_values || []).filter(c => c.type === 'file' && c.value);
    if (fileColumns.length === 0) return;

    // Get all assets for this item
    const assetsResult = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Authorization': process.env.MONDAY_API_TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-10' },
      body: JSON.stringify({ query: `{ items(ids: [${itemId}]) { assets { id name url public_url file_extension } } }` })
    }).then(r => r.json());

    const allAssets = assetsResult.data?.items?.[0]?.assets || [];
    if (allAssets.length === 0) return;

    // Post assets as attachments
    const imageAssets = allAssets.filter(a => /\.(jpg|jpeg|png|gif|webp|pdf)$/i.test(a.name));
    if (imageAssets.length === 0) return;

    const files = [];
    for (const asset of imageAssets.slice(0, 10)) {
      try {
        const res = await fetch(asset.public_url || asset.url);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          files.push(new AttachmentBuilder(buffer, { name: asset.name }));
        }
      } catch {}
    }

    if (files.length > 0) {
      const colNames = fileColumns.map(c => c.title || c.id).join(', ');
      await thread.send({ content: `📎 **Existing files** (${colNames}) — ${files.length} file(s)`, files });
      console.log(`[Webhook] Posted ${files.length} existing file(s) to new thread ${thread.id}`);
    }
  } catch (err) {
    console.error(`[Webhook] Error posting existing files for item ${itemId}:`, err.message);
  }
}

/**
 * Create a new Discord thread for a Monday.com item.
 * Uses the rich pinned-post format and pins the starter message.
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

    // Check if a thread with this name already exists (prevents duplicates from manual creation)
    const threadName = itemDetails.name || `Monday Item ${itemId}`;
    const existingThreadId = await findExistingThreadByName(forumChannel, threadName, itemId);
    if (existingThreadId) {
      console.log(`[Webhook] Thread already exists for "${threadName}" (${existingThreadId}), mapped instead of creating duplicate`);
      return existingThreadId;
    }

    // Build initial message with all project info using the shared formatter
    const { fields, values } = buildFieldsFromItemDetails(itemDetails);
    const message = formatPinnedPost(threadName, itemId, fields, values);

    // Create the thread
    const thread = await forumChannel.threads.create({
      name: threadName,
      message: { content: message },
    });

    console.log(`[Webhook] Created Discord thread ${thread.id} for Monday item ${itemId}`);

    // Map the thread
    await mapThread(itemId, thread.id, threadName);

    // Pin the starter message and store its ID
    await pinStarterMessage(thread, itemId);

    // Post any existing files (permits, etc.) that were already on the item
    await postExistingFiles(thread, itemId, itemDetails);

    // Track stat
    await incrementStat('threadsCreated');

    return thread.id;
  } catch (error) {
    console.error(`[Webhook] Error creating Discord thread for item ${itemId}:`, error);
    return null;
  }
}
