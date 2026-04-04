// src/services/mondayMentionHandler.js
// Handles @MondayBot mentions in Discord

import { getThreadId } from './threadMapper.js';
import { addUpdate, uploadFile, updateColumn, getItem } from './mondayApi.js';

/**
 * Handle @MondayBot mention
 */
export async function handleMondayBotMention(message) {
  try {
    // Must be in a thread (project channel)
    if (!message.channel.isThread()) {
      await message.reply('❌ Please use @MondayBot commands inside a project thread.');
      return;
    }

    // Get Monday item ID from thread mapping
    const threadId = message.channel.id;
    const mondayItemId = await getMondayItemIdFromThread(threadId);

    if (!mondayItemId) {
      await message.reply('❌ This thread is not linked to a Monday.com project.');
      return;
    }

    // Check if this is a reply to another message — forward that message to Monday
    if (message.reference?.messageId) {
      await handleForwardReply(message, mondayItemId);
      return;
    }

    // Remove bot mention from message to get the command
    const content = message.content
      .replace(/<@!?\d+>/g, '') // Remove mentions
      .trim();

    // Parse command
    const parts = content.split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1).join(' ');

    console.log(`[MondayBot] Command: ${command}, Args: ${args}`);

    // Route to appropriate handler
    switch (command) {
      case 'update':
      case 'note':
      case 'comment':
        await handleUpdateCommand(message, mondayItemId, args);
        break;

      case 'status':
        await handleStatusCommand(message, mondayItemId, args);
        break;

      case 'attach':
      case 'upload':
        await handleAttachCommand(message, mondayItemId, args);
        break;

      case 'help':
        await handleHelpCommand(message);
        break;

      default:
        // If no command specified, treat entire message as an update
        await handleUpdateCommand(message, mondayItemId, content);
    }
  } catch (error) {
    console.error('[MondayBot] Error handling mention:', error);
    await message.reply('❌ An error occurred: ' + error.message);
  }
}

/**
 * Get the server nickname for a message author
 */
function getNickname(message) {
  return message.member?.displayName || message.author.displayName || message.author.username;
}

/**
 * Handle reply-to-forward: user replies to a message and @MondayBot to forward it
 */
async function handleForwardReply(message, mondayItemId) {
  const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
  if (!repliedTo) {
    await message.reply('❌ Could not find the message you replied to.');
    return;
  }

  const originalAuthor = repliedTo.member?.displayName || repliedTo.author.displayName || repliedTo.author.username;
  const forwardedBy = getNickname(message);

  // Build the update text from the replied message
  let forwardText = '';

  // Include text content
  if (repliedTo.content) {
    forwardText += repliedTo.content;
  }

  // Include embed descriptions (e.g. daily report embeds)
  if (repliedTo.embeds?.length > 0) {
    for (const embed of repliedTo.embeds) {
      if (embed.title) forwardText += `\n${embed.title}`;
      if (embed.description) forwardText += `\n${embed.description}`;
      for (const field of (embed.fields || [])) {
        forwardText += `\n**${field.name}:** ${field.value}`;
      }
    }
  }

  if (!forwardText.trim()) {
    await message.reply('❌ That message has no text content to forward.');
    return;
  }

  // Include any additional note from the person forwarding
  const extraNote = message.content.replace(/<@!?\d+>/g, '').trim();

  let updateText = `**From ${originalAuthor} (forwarded by ${forwardedBy} via Discord):**\n${forwardText}`;
  if (extraNote) {
    updateText += `\n\n**Note from ${forwardedBy}:** ${extraNote}`;
  }

  await addUpdate(mondayItemId, updateText);
  await message.react('✅');
  await message.reply(`✅ Forwarded to Monday.com`);

  console.log(`[MondayBot] Forwarded message from ${originalAuthor} to Monday item ${mondayItemId} (by ${forwardedBy})`);
}

/**
 * Handle update/note/comment command
 */
async function handleUpdateCommand(message, mondayItemId, text) {
  if (!text || text.length === 0) {
    await message.reply('❌ Please provide update text. Example:\n`@MondayBot update Materials delivered to site`');
    return;
  }

  // Add author info to the update
  const updateText = `**From ${getNickname(message)} (Discord):**\n${text}`;

  // Post to Monday.com
  await addUpdate(mondayItemId, updateText);

  // Confirm in Discord
  await message.react('✅');
  await message.reply(`✅ Update posted to Monday.com`);

  console.log(`[MondayBot] Posted update to Monday item ${mondayItemId}`);
}

/**
 * Handle status change command
 */
async function handleStatusCommand(message, mondayItemId, statusText) {
  if (!statusText) {
    await message.reply('❌ Please specify a status. Example:\n`@MondayBot status In Progress`');
    return;
  }

  try {
    // Get item details to find board ID and status column
    const item = await getItem(mondayItemId);

    // Find status column (usually named "Status" or has type "status")
    const statusColumn = item.column_values.find(col =>
      col.title.toLowerCase() === 'status' ||
      col.id.includes('status')
    );

    if (!statusColumn) {
      await message.reply('❌ Could not find status column on this Monday.com item.');
      return;
    }

    // Update the status
    await updateColumn(item.board.id, mondayItemId, statusColumn.id, statusText);

    // Confirm in Discord
    await message.react('✅');
    await message.reply(`✅ Status changed to: **${statusText}**`);

    console.log(`[MondayBot] Changed status to "${statusText}" for item ${mondayItemId}`);
  } catch (error) {
    console.error('[MondayBot] Error updating status:', error);
    await message.reply('❌ Failed to update status. Make sure the status value is valid.');
  }
}

/**
 * Handle file attachment command
 */
async function handleAttachCommand(message, mondayItemId, caption) {
  const attachments = Array.from(message.attachments.values());

  if (attachments.length === 0) {
    await message.reply('❌ Please attach files to upload. Example:\n`@MondayBot attach [attach files] Site progress photos`');
    return;
  }

  // Upload each attachment
  for (const attachment of attachments) {
    try {
      await uploadFile(mondayItemId, attachment.url, attachment.name);
      console.log(`[MondayBot] Uploaded file "${attachment.name}" to Monday item ${mondayItemId}`);
    } catch (error) {
      console.error(`[MondayBot] Error uploading file "${attachment.name}":`, error);
    }
  }

  // If caption provided, also add as update
  if (caption && caption.length > 0) {
    const updateText = `**From ${getNickname(message)} (Discord):**\n${caption}\n\n_${attachments.length} file(s) attached_`;
    await addUpdate(mondayItemId, updateText);
  }

  // Confirm in Discord
  await message.react('✅');
  await message.reply(`✅ Uploaded ${attachments.length} file(s) to Monday.com`);
}

/**
 * Handle help command
 */
async function handleHelpCommand(message) {
  const helpText = `**MondayBot Commands**

Use these in project threads to sync with Monday.com:

**📤 Forward a message:**
Reply to any message and tag \`@MondayBot\` to forward it to Monday.com

**📝 Add Update:**
\`@MondayBot update Materials delivered to site\`
\`@MondayBot note Crew size increased to 8\`

**📊 Change Status:**
\`@MondayBot status In Progress\`

**📎 Upload Files:**
\`@MondayBot attach [attach files] Site progress photos\`

**💡 Quick Update:**
\`@MondayBot Foundation work completed today\`

All updates include your server nickname and are posted to Monday.com.`;

  await message.reply(helpText);
}

/**
 * Get Monday item ID from thread ID (reverse lookup)
 */
async function getMondayItemIdFromThread(threadId) {
  const { getAllMappings } = await import('./threadMapper.js');
  const mappings = await getAllMappings();

  // Search for thread ID in mappings
  for (const [itemId, mapping] of Object.entries(mappings)) {
    if (mapping.threadId === threadId) {
      return itemId;
    }
  }

  return null;
}
