// src/services/mondayMentionHandler.js
// Handles @MondayBot mentions in Discord

import { getThreadId } from './threadMapper.js';
import { addUpdate, uploadFileToUpdate, updateColumn, getItem } from './mondayApi.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';
import sharp from 'sharp';

const MLB_OFFICE_ROLE_ID = process.env.MLB_OFFICE_ROLE_ID || '1396930700447449149';
const OPS_LEADERSHIP_ROLE_ID = '1411793485799096490';
const SURVEYOR_ROLE_ID = '1473765347005042761';

// Photo selection sessions for @MondayBot photo flow
const photoSessions = new Map();

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
        // If text was provided, treat as an update
        if (content) {
          await handleUpdateCommand(message, mondayItemId, content);
        } else {
          // No text — show action panel
          await handleShowPanel(message, mondayItemId);
        }
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

  // Create update first, then attach files to it
  const updateText = `**From ${getNickname(message)} (Discord):**\n${caption || `${attachments.length} file(s) attached`}`;
  const update = await addUpdate(mondayItemId, updateText);

  let uploaded = 0;
  for (const attachment of attachments) {
    try {
      const fileName = attachment.name.replace(/\.[^.]+$/, '.jpeg') || `file-${uploaded + 1}.jpeg`;
      await uploadFileToUpdate(update.id, attachment.url, fileName);
      uploaded++;
      console.log(`[MondayBot] Uploaded file "${attachment.name}" to Monday item ${mondayItemId}`);
    } catch (error) {
      console.error(`[MondayBot] Error uploading file "${attachment.name}":`, error);
    }
  }

  await message.react('✅');
  await message.reply(`✅ Uploaded ${uploaded} of ${attachments.length} file(s) to Monday.com`);
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
 * Check if a member has ops/office/surveyor permission
 */
function hasForwardPermission(member) {
  if (!member) return false;
  if (member.roles.cache.has(MLB_OFFICE_ROLE_ID)) return true;
  if (member.roles.cache.has(OPS_LEADERSHIP_ROLE_ID)) return true;
  if (member.roles.cache.has(SURVEYOR_ROLE_ID)) return true;
  return false;
}

/**
 * Show action panel when @MondayBot is mentioned with no command
 */
async function handleShowPanel(message, mondayItemId) {
  const rows = [];

  // Forward buttons for ops/office/surveyor
  if (hasForwardPermission(message.member)) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mb:photos:${mondayItemId}`)
        .setLabel('Send Photos to Monday')
        .setStyle(ButtonStyle.Success)
        .setEmoji('📸'),
      new ButtonBuilder()
        .setCustomId(`mb:forward_recent:${mondayItemId}`)
        .setLabel('Forward Recent Messages')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📤'),
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mb:write_update:${mondayItemId}`)
      .setLabel('Write Update to Monday')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📝'),
    new ButtonBuilder()
      .setCustomId(`mb:help`)
      .setLabel('Help')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❓'),
  ));

  await message.reply({
    content: '**MondayBot** — What would you like to do?',
    components: rows,
  });
}

/**
 * Handle MondayBot button interactions.
 * Called from the interaction handler in index.js.
 */
export async function handleMondayBotButton(interaction) {
  const id = interaction.customId;

  // ── Help ──
  if (id === 'mb:help') {
    await interaction.reply({ content: helpText(), flags: 64 });
    return;
  }

  // ── Write Update modal ──
  if (id.startsWith('mb:write_update:')) {
    const mondayItemId = id.replace('mb:write_update:', '');
    const modal = new ModalBuilder()
      .setCustomId(`mb:update_modal:${mondayItemId}`)
      .setTitle('Write Update to Monday.com');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('update_text')
        .setLabel('Your update')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
    ));
    await interaction.showModal(modal);
    return;
  }

  // ── Send Photos flow ──
  if (id.startsWith('mb:photos:')) {
    if (!hasForwardPermission(interaction.member)) {
      return interaction.reply({ content: '❌ Only Ops/Office/Surveyor roles can do this.', flags: 64 });
    }
    const mondayItemId = id.replace('mb:photos:', '');
    await interaction.deferReply({ flags: 64 });

    // Collect photos from thread
    const thread = interaction.channel;
    const messages = await thread.messages.fetch({ limit: 100 });
    const photos = [];

    for (const [, msg] of messages) {
      if (msg.author.bot) continue;
      for (const att of msg.attachments.values()) {
        if (att.contentType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(att.name)) {
          photos.push({
            url: att.url,
            name: att.name,
            author: msg.member?.displayName || msg.author.displayName || msg.author.username,
            timestamp: msg.createdTimestamp,
          });
        }
      }
      for (const emb of msg.embeds) {
        if (emb.image?.url) {
          photos.push({
            url: emb.image.url,
            name: 'pasted-image.jpeg',
            author: msg.member?.displayName || msg.author.displayName || msg.author.username,
            timestamp: msg.createdTimestamp,
          });
        }
      }
    }

    // Sort newest first
    photos.sort((a, b) => b.timestamp - a.timestamp);

    if (photos.length === 0) {
      return interaction.editReply('❌ No photos found in this thread.');
    }

    const sessionKey = `${interaction.user.id}_${mondayItemId}`;
    photoSessions.set(sessionKey, {
      photos, selected: new Set(), page: 0, mondayItemId,
    });

    await showPhotoPage(interaction, sessionKey);
    return;
  }

  // ── Forward Recent Messages ──
  if (id.startsWith('mb:forward_recent:')) {
    if (!hasForwardPermission(interaction.member)) {
      return interaction.reply({ content: '❌ Only Ops/Office/Surveyor roles can do this.', flags: 64 });
    }
    const mondayItemId = id.replace('mb:forward_recent:', '');
    await interaction.deferReply({ flags: 64 });

    const thread = interaction.channel;
    const messages = await thread.messages.fetch({ limit: 30 });
    // Get non-bot messages from the last 24h, newest first
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = messages
      .filter(m => !m.author.bot && m.createdTimestamp > cutoff)
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .first(10);

    if (recent.length === 0) {
      return interaction.editReply('❌ No recent messages (last 24h) found to forward.');
    }

    // Format and send
    const lines = recent.map(m => {
      const author = m.member?.displayName || m.author.displayName || m.author.username;
      const time = new Date(m.createdTimestamp).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
      const text = m.content || (m.embeds[0]?.description?.substring(0, 200)) || '(attachment)';
      return `**${author}** (${time}): ${text}`;
    }).join('\n\n');

    const body = `**Recent Discord Messages (forwarded by ${interaction.member?.displayName || interaction.user.displayName}):**\n\n${lines}`;
    await addUpdate(mondayItemId, body);
    await interaction.editReply(`✅ Forwarded ${recent.length} recent message(s) to Monday.com`);
    return;
  }

  // ── Photo Toggle (select/deselect a photo by index) ──
  if (id.startsWith('mb:ptoggle:')) {
    const parts = id.split(':');
    const photoIndex = parseInt(parts[2]);
    const sessionKey = parts.slice(3).join(':');
    const session = photoSessions.get(sessionKey);
    if (!session) return interaction.update({ content: '❌ Session expired. Tag @MondayBot again.', embeds: [], components: [] });

    if (session.selected.has(photoIndex)) {
      session.selected.delete(photoIndex);
    } else {
      session.selected.add(photoIndex);
    }
    session.preview = photoIndex;
    await showPhotoPage(interaction, sessionKey, true);
    return;
  }

  // ── Photo Page Navigation ──
  if (id.startsWith('mb:ppage:')) {
    const parts = id.split(':');
    const dir = parts[2]; // prev or next
    const sessionKey = parts.slice(3).join(':');
    const session = photoSessions.get(sessionKey);
    if (!session) return interaction.update({ content: '❌ Session expired.', embeds: [], components: [] });

    if (dir === 'next') session.page++;
    else if (dir === 'prev') session.page--;
    await showPhotoPage(interaction, sessionKey, true);
    return;
  }

  // ── Photo Send Selected ──
  if (id.startsWith('mb:psend:')) {
    const sessionKey = id.replace('mb:psend:', '');
    const session = photoSessions.get(sessionKey);
    if (!session) return interaction.update({ content: '❌ Session expired.', embeds: [], components: [] });
    if (session.selected.size === 0) {
      return interaction.update({ content: '❌ No photos selected. Tap the numbered buttons to select photos first.', embeds: [], components: [] });
    }

    // Dismiss the ephemeral interaction immediately
    await interaction.update({ content: `⏳ Uploading ${session.selected.size} photo(s) to Monday.com...`, embeds: [], components: [] });

    // Post a visible progress message in the thread so it doesn't time out
    const channel = interaction.channel;
    const statusMsg = await channel.send(`⏳ Uploading **${session.selected.size}** photo(s) to Monday.com...`);

    try {
      const selectedPhotos = [...session.selected].map(i => session.photos[i]);
      const update = await addUpdate(session.mondayItemId, `📸 ${selectedPhotos.length} photo(s) from Discord`);

      // Upload 3 at a time in parallel for speed
      let uploaded = 0;
      let errors = 0;
      for (let i = 0; i < selectedPhotos.length; i += 3) {
        const batch = selectedPhotos.slice(i, i + 3);
        const results = await Promise.allSettled(
          batch.map((photo, j) => {
            const fileName = photo.name.replace(/\.[^.]+$/, '.jpeg') || `photo-${i + j + 1}.jpeg`;
            return uploadFileToUpdate(update.id, photo.url, fileName);
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') uploaded++;
          else { errors++; console.error('[MondayBot] Photo upload failed:', r.reason?.message); }
        }
        // Update progress in the thread
        await statusMsg.edit(`⏳ Uploading photos... **${uploaded}/${selectedPhotos.length}** done${errors > 0 ? ` (${errors} failed)` : ''}`).catch(() => {});
      }

      await statusMsg.edit(`✅ Uploaded **${uploaded}** photo(s) to Monday.com${errors > 0 ? ` (${errors} failed)` : ''}`);
    } catch (error) {
      await statusMsg.edit(`❌ Photo upload failed: ${error.message}`).catch(() => {});
    }
    photoSessions.delete(sessionKey);
    return;
  }

  // ── Photo Cancel ──
  if (id.startsWith('mb:pcancel:')) {
    const sessionKey = id.replace('mb:pcancel:', '');
    photoSessions.delete(sessionKey);
    await interaction.update({ content: '❌ Cancelled.', embeds: [], components: [] });
    return;
  }
}

/**
 * Handle MondayBot modal submissions
 */
export async function handleMondayBotModal(interaction) {
  if (interaction.customId.startsWith('mb:update_modal:')) {
    const mondayItemId = interaction.customId.replace('mb:update_modal:', '');
    await interaction.deferReply({ flags: 64 });
    const text = interaction.fields.getTextInputValue('update_text');
    const name = interaction.member?.displayName || interaction.user.displayName;
    await addUpdate(mondayItemId, `**From ${name} (Discord):**\n${text}`);
    await interaction.editReply('✅ Update posted to Monday.com');
  }
}

// ── Photo Page UI ──
const PAGE_SIZE = 5;

async function showPhotoPage(interaction, sessionKey, isUpdate = false) {
  const session = photoSessions.get(sessionKey);
  const { photos, selected, page, preview } = session;
  const totalPages = Math.ceil(photos.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const pagePhotos = photos.slice(start, start + PAGE_SIZE);

  // Which photo to show large — default to first on page
  // Header embed
  const headerEmbed = new EmbedBuilder()
    .setTitle(`📸 Photos to include: (${selected.size} selected)`)
    .setDescription(`Page ${page + 1} of ${totalPages} • ${photos.length} total`)
    .setColor(0x00b0f4);

  // One embed per photo with full-size image
  const photoEmbeds = pagePhotos.map((p, i) => {
    const idx = start + i;
    const check = selected.has(idx) ? '✅' : '⬜';
    const time = new Date(p.timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return new EmbedBuilder()
      .setDescription(`${check} **${i + 1}.** ${p.author} — ${time}`)
      .setThumbnail(p.url);
  });

  // Toggle buttons — one row of up to 5
  const toggleRow = new ActionRowBuilder();
  pagePhotos.forEach((p, i) => {
    const idx = start + i;
    const day = new Date(p.timestamp).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric' });
    toggleRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`mb:ptoggle:${idx}:${sessionKey}`)
        .setLabel(`${selected.has(idx) ? '✅' : '⬜'} ${i + 1} (${day})`)
        .setStyle(selected.has(idx) ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  });

  // Navigation + action row
  const navRow = new ActionRowBuilder();
  if (page > 0) {
    navRow.addComponents(new ButtonBuilder().setCustomId(`mb:ppage:prev:${sessionKey}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary));
  }
  if (page < totalPages - 1) {
    navRow.addComponents(new ButtonBuilder().setCustomId(`mb:ppage:next:${sessionKey}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary));
  }
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`mb:psend:${sessionKey}`)
      .setLabel(`Send ${selected.size} to Monday`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(selected.size === 0),
    new ButtonBuilder().setCustomId(`mb:pcancel:${sessionKey}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );

  const payload = { embeds: [headerEmbed, ...photoEmbeds], components: [toggleRow, navRow] };
  if (isUpdate) await interaction.update(payload);
  else await interaction.editReply(payload);
}

function helpText() {
  return `**MondayBot Commands**

**Just tag @MondayBot** (no text) to get action buttons:
- 📸 Send Photos to Monday
- 📤 Forward Recent Messages
- 📝 Write Update to Monday

**Reply to a message + @MondayBot** to forward that specific message.

**Text commands:**
\`@MondayBot update Materials delivered\`
\`@MondayBot status In Progress\`
\`@MondayBot attach [files] Caption here\``;
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
