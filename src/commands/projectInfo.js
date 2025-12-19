// src/commands/projectInfo.js
import { SlashCommandBuilder } from 'discord.js';
import { getMondayItemIdFromThread } from '../services/threadMapper.js';
import { getItem } from '../services/mondayApi.js';

export const data = new SlashCommandBuilder()
  .setName('project-info')
  .setDescription('Show all key project details from Monday.com');

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 }); // EPHEMERAL

  try {
    // Check if in a thread
    if (!interaction.channel.isThread()) {
      await interaction.editReply({
        content: '❌ This command can only be used in project threads.',
        flags: 64
      });
      return;
    }

    // Get Monday.com item ID
    const mondayItemId = await getMondayItemIdFromThread(interaction.channel.id);
    if (!mondayItemId) {
      await interaction.editReply({
        content: '❌ This thread is not mapped to a Monday.com project.',
        flags: 64
      });
      return;
    }

    // Fetch item details
    const itemDetails = await getItem(mondayItemId);
    if (!itemDetails) {
      await interaction.editReply({
        content: '❌ Could not fetch project details from Monday.com.',
        flags: 64
      });
      return;
    }

    // Extract fields
    const fields = {};
    if (itemDetails.column_values) {
      itemDetails.column_values.forEach(col => {
        fields[col.title] = col.text || 'Not set';
      });
    }

    // Build message
    let message = `📋 **Project Information**\n\n`;
    message += `**${itemDetails.name}**\n`;
    message += `Monday.com ID: \`${mondayItemId}\`\n\n`;
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

    // Post to thread (not ephemeral)
    await interaction.channel.send(message);

    await interaction.editReply({
      content: '✅ Posted project info to thread!',
      flags: 64
    });

  } catch (error) {
    console.error('[ProjectInfo] Error:', error);
    await interaction.editReply({
      content: '❌ An error occurred while fetching project info.',
      flags: 64
    });
  }
}
