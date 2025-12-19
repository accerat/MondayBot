// src/commands/mondayStatus.js
import { SlashCommandBuilder } from 'discord.js';
import { getAllMappings } from '../services/threadMapper.js';

export const data = new SlashCommandBuilder()
  .setName('monday-status')
  .setDescription('Check MondayBot status and thread mappings');

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 }); // EPHEMERAL

  try {
    const mappings = await getAllMappings();
    const mappingCount = Object.keys(mappings).length;

    let message = `**🤖 MondayBot Status**\n\n`;
    message += `✅ Bot is online and running\n`;
    message += `📊 Mapped threads: ${mappingCount}\n\n`;

    if (mappingCount > 0) {
      message += `**Recent Mappings:**\n`;
      const recentMappings = Object.entries(mappings).slice(-5);
      for (const [itemId, mapping] of recentMappings) {
        message += `• ${mapping.projectName} (ID: ${itemId})\n`;
      }
    }

    message += `\n**Webhook Server:** Running on port ${process.env.WEBHOOK_PORT || 3001}\n`;
    message += `**Monday.com API:** ${process.env.MONDAY_API_TOKEN ? 'Configured ✅' : 'Not configured ❌'}`;

    await interaction.editReply({ content: message });
  } catch (error) {
    console.error('[monday-status] Error:', error);
    await interaction.editReply({
      content: `Error checking status: ${error.message}`
    });
  }
}
