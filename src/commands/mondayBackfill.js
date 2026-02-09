// src/commands/mondayBackfill.js
// Command to find Monday.com items missing Discord threads

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getESSProjects } from '../services/mondayApi.js';
import { getThreadId } from '../services/threadMapper.js';

export const data = new SlashCommandBuilder()
  .setName('monday-backfill')
  .setDescription('Find Monday.com items missing Discord threads')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(option =>
    option
      .setName('board')
      .setDescription('Which board to check')
      .setRequired(false)
      .addChoices(
        { name: 'MLB 2026 ESS', value: '2026' },
        { name: '2025 ESS', value: '2025' },
        { name: 'Both', value: 'both' }
      )
  );

export async function execute(interaction, discordClient) {
  await interaction.deferReply({ flags: 64 });

  const board = interaction.options.getString('board') || 'both';

  try {
    await interaction.editReply({ content: 'Scanning Monday.com boards...' });

    // Get all projects
    const allProjects = await getESSProjects();
    const boardFilter = board === 'both' ? null :
                        board === '2026' ? 'MLB 2026 ESS' : '2025 ESS';

    const projects = boardFilter
      ? allProjects.filter(p => p.boardName === boardFilter)
      : allProjects;

    // Check which ones are missing threads
    const missing = [];
    const flagged = [];

    for (const project of projects) {
      const mapping = await getThreadId(project.mondayItemId);
      if (!mapping) {
        // Check if it has valid branch
        const branch = project.rawColumns?.dropdown_mm07kqx?.text || '';
        const branchLower = branch.toLowerCase();

        if (branchLower === 'ess' || branchLower === 'opd') {
          missing.push(project);
        } else {
          flagged.push({ ...project, branchValue: branch || '(empty)' });
        }
      }
    }

    let message = `**Backfill Analysis**\n\n`;
    message += `**Board(s):** ${board === 'both' ? 'All' : boardFilter}\n`;
    message += `**Total Items Scanned:** ${projects.length}\n\n`;

    message += `**Missing Threads (valid branch):** ${missing.length}\n`;
    for (const p of missing.slice(0, 10)) {
      message += `- ${p.name}\n`;
    }
    if (missing.length > 10) {
      message += `... and ${missing.length - 10} more\n`;
    }

    message += `\n**Would Be Flagged (invalid branch):** ${flagged.length}\n`;
    for (const p of flagged.slice(0, 5)) {
      message += `- ${p.name} (Branch: ${p.branchValue})\n`;
    }
    if (flagged.length > 5) {
      message += `... and ${flagged.length - 5} more\n`;
    }

    if (missing.length > 0) {
      message += `\n*Run \`/monday-sync-projects\` to create threads for missing items.*`;
    }

    if (message.length > 2000) {
      message = message.substring(0, 1950) + '\n\n... (truncated)';
    }

    await interaction.editReply({ content: message });

  } catch (error) {
    console.error('[monday-backfill] Error:', error);
    await interaction.editReply({ content: `Error: ${error.message}` });
  }
}
