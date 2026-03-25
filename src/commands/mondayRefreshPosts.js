// src/commands/mondayRefreshPosts.js
import { SlashCommandBuilder } from 'discord.js';
import { updateAllPinnedPosts } from '../services/projectSyncOrchestrator.js';

export const data = new SlashCommandBuilder()
  .setName('monday-refresh-posts')
  .setDescription('Refresh all pinned posts with latest Monday.com data');

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await updateAllPinnedPosts(interaction.client, { createIfMissing: true });
    await interaction.editReply(
      `**Pinned Post Refresh Complete**\n` +
      `Updated: ${result.updated}\n` +
      `Skipped: ${result.skipped}\n` +
      `Errors: ${result.errors}\n` +
      `Total: ${result.total}`
    );
  } catch (error) {
    console.error('[RefreshPosts] Error:', error);
    await interaction.editReply(`Error refreshing posts: ${error.message}`);
  }
}
