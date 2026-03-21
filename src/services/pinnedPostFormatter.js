// src/services/pinnedPostFormatter.js
// Shared formatter for the pinned initial post in Discord threads.
// Used by all thread creation paths and the pinned-post-update flow.

import { getItem } from './mondayApi.js';
import { getPinnedMessageId, savePinnedMessageId } from './threadMapper.js';

/**
 * Build a { fields, values } map from a getItem() result.
 * `fields` maps column title → display text.
 * `values` maps column title → parsed JSON value (for link columns, etc.).
 */
export function buildFieldsFromItemDetails(itemDetails) {
  const fields = {};
  const values = {};
  if (itemDetails.column_values) {
    itemDetails.column_values.forEach(col => {
      const title = col.title || col.id;
      fields[title] = col.text || '';
      try {
        values[title] = col.value ? JSON.parse(col.value) : null;
      } catch {
        values[title] = null;
      }
    });
  }
  return { fields, values };
}

/**
 * Format the rich pinned post content.
 * @param {string} itemName - Project / item name
 * @param {string} itemId   - Monday.com item ID
 * @param {object} fields   - title → text map
 * @param {object} values   - title → parsed JSON map
 */
export function formatPinnedPost(itemName, itemId, fields, values = {}) {
  const lines = [];

  lines.push(`📌 **PROJECT INFO**\n`);
  lines.push(`**${itemName}**`);
  lines.push(`Monday.com ID: \`${itemId}\`\n`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // --- Core project details ---
  if (fields['Store Address']) {
    lines.push(`📍 **Store Address:** ${fields['Store Address']}`);
  }

  if (fields['Sage #']) {
    lines.push(`📋 **Sage #:** ${fields['Sage #']}`);
  }

  if (fields['Start Date']) {
    lines.push(`📅 **Start Date:** ${fields['Start Date']}`);
  }

  if (fields['Start Status']) {
    lines.push(`🚦 **Start Status:** ${fields['Start Status']}`);
  }

  if (fields['Crew']) {
    lines.push(`👷 **Crew:** ${fields['Crew']}`);
  }

  if (fields['Super']) {
    lines.push(`🔧 **Superintendent:** ${fields['Super']}`);
  }

  if (fields['Timeline']) {
    lines.push(`🗓️ **Timeline:** ${fields['Timeline']}`);
  }

  if (fields['Duration']) {
    lines.push(`⏱️ **Duration:** ${fields['Duration']} days`);
  }

  // --- Material info ---
  if (fields['Material Quantities']) {
    const mq = fields['Material Quantities'];
    const truncated = mq.length > 500 ? mq.substring(0, 500) + '...' : mq;
    lines.push(`\n📦 **Material Quantities:**\n\`\`\`\n${truncated}\n\`\`\``);
  }

  if (fields['Material Notes']) {
    lines.push(`📝 **Material Notes:** ${fields['Material Notes']}`);
  }

  // --- Plans folder ---
  const plansVal = values['Plans Folder'];
  if (plansVal?.url) {
    const label = plansVal.text || 'Plans';
    lines.push(`\n📁 **Plans Folder:** [${label}](${plansVal.url})`);
  } else if (fields['Plans Folder']) {
    lines.push(`\n📁 **Plans Folder:** ${fields['Plans Folder']}`);
  }

  // --- MLB SOW ---
  if (fields['MLB SOW']) {
    const sow = fields['MLB SOW'];
    const truncated = sow.length > 400 ? sow.substring(0, 400) + '...' : sow;
    lines.push(`\n📄 **MLB SOW:**\n\`\`\`\n${truncated}\n\`\`\``);
  }

  // --- CTL Section ---
  const hasCTL = fields['CTL'] || fields['CTL Company'] || fields['CTL Phone #'] || fields['CTL Email'];
  if (hasCTL) {
    lines.push(`\n━━━ **CTL Info** ━━━`);
    if (fields['CTL']) lines.push(`📋 **Status:** ${fields['CTL']}`);
    if (fields['CTL Company']) lines.push(`🏢 **Company:** ${fields['CTL Company']}`);
    if (fields['CTL Phone #']) lines.push(`📞 **Phone:** ${fields['CTL Phone #']}`);
    if (fields['CTL Email']) lines.push(`📧 **Email:** ${fields['CTL Email']}`);
  }

  // --- Electrician Section ---
  const hasElec = fields['Electrician Status'] || fields['Electrician Company'] || fields['Electrician Contact'] ||
                  fields['Electrician Number'] || fields['Electrician Email'] || fields['Electrician Scope Status'];
  if (hasElec) {
    lines.push(`\n━━━ **Electrician Info** ━━━`);
    if (fields['Electrician Status']) lines.push(`⚡ **Electrician:** ${fields['Electrician Status']}`);
    if (fields['Electrician Scope Status']) lines.push(`📋 **Scope Status:** ${fields['Electrician Scope Status']}`);
    if (fields['Electrician Company']) lines.push(`🏢 **Company:** ${fields['Electrician Company']}`);
    if (fields['Electrician Contact']) lines.push(`👤 **Contact:** ${fields['Electrician Contact']}`);
    if (fields['Electrician Number']) lines.push(`📞 **Phone:** ${fields['Electrician Number']}`);
    if (fields['Electrician Email']) lines.push(`📧 **Email:** ${fields['Electrician Email']}`);
  }

  lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`✅ *Synced with Monday.com — updates will appear here*`);

  return lines.join('\n');
}

/**
 * Pin the starter message of a forum thread and store its ID.
 * Call this right after creating the thread.
 * @param {ThreadChannel} thread - The created Discord thread
 * @param {string} mondayItemId  - Monday.com item ID (for mapping)
 */
export async function pinStarterMessage(thread, mondayItemId) {
  try {
    const starterMsg = await thread.fetchStarterMessage();
    if (starterMsg) {
      await starterMsg.pin();
      await savePinnedMessageId(mondayItemId, starterMsg.id);
      console.log(`[PinnedPost] Pinned starter message ${starterMsg.id} for item ${mondayItemId}`);
    }
  } catch (error) {
    console.error(`[PinnedPost] Failed to pin starter message for item ${mondayItemId}:`, error.message);
  }
}

/**
 * Update the pinned post for an item with the latest data from Monday.com.
 * Fetches the item fresh from the API to ensure data is current.
 * @param {ThreadChannel} thread        - The Discord thread
 * @param {string}        mondayItemId  - Monday.com item ID
 * @param {object}        [itemDetails] - Optional pre-fetched item details (avoids extra API call)
 */
export async function updatePinnedPost(thread, mondayItemId, itemDetails = null) {
  try {
    // Use provided details or fetch fresh
    const details = itemDetails || await getItem(mondayItemId);
    if (!details) {
      console.error(`[PinnedPost] Could not get item details for ${mondayItemId}`);
      return;
    }

    const { fields, values } = buildFieldsFromItemDetails(details);
    const newContent = formatPinnedPost(details.name, mondayItemId, fields, values);

    // Find the pinned message
    let pinnedMsgId = await getPinnedMessageId(mondayItemId);

    if (!pinnedMsgId) {
      // Fallback: try the starter message of the forum thread
      try {
        const starterMsg = await thread.fetchStarterMessage();
        if (starterMsg && starterMsg.author.id === thread.client.user.id) {
          pinnedMsgId = starterMsg.id;
          await savePinnedMessageId(mondayItemId, pinnedMsgId);
        }
      } catch {
        // Thread may not be a forum thread (e.g. regular text channel thread)
      }
    }

    if (!pinnedMsgId) {
      // No existing pinned post — create one, pin it, and save the ID
      console.log(`[PinnedPost] No pinned message found for item ${mondayItemId}, creating new one`);
      try {
        const newMsg = await thread.send(newContent);
        await newMsg.pin();
        await savePinnedMessageId(mondayItemId, newMsg.id);
        console.log(`[PinnedPost] Created and pinned new post ${newMsg.id} for item ${mondayItemId}`);
      } catch (createErr) {
        console.error(`[PinnedPost] Failed to create pinned post for item ${mondayItemId}:`, createErr.message);
      }
      return;
    }

    const msg = await thread.messages.fetch(pinnedMsgId);
    if (!msg) {
      console.log(`[PinnedPost] Could not fetch message ${pinnedMsgId}`);
      return;
    }

    // Only edit messages we own
    if (msg.author.id !== thread.client.user.id) {
      console.log(`[PinnedPost] Message ${pinnedMsgId} not owned by bot, skipping edit`);
      return;
    }

    await msg.edit(newContent);
    console.log(`[PinnedPost] Updated pinned post for item ${mondayItemId}`);
  } catch (error) {
    console.error(`[PinnedPost] Error updating pinned post for item ${mondayItemId}:`, error.message);
  }
}
