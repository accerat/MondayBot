// src/commands/mondayBackfill.js
// Command to find Monday.com items missing Discord threads

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getESSProjects } from '../services/mondayApi.js';
import { getThreadId } from '../services/threadMapper.js';

export const data = new SlashCommandBuilder()
  .setName('monday-backfill')
  .setDescription('Find Monday.com items missing Discord threads (MLB 2026 ESS)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction, discordClient) {
  await interaction.deferReply({ flags: 64 });

  try {
    await interaction.editReply({ content: 'Scanning MLB 2026 ESS board...' });

    // Get all projects (already filtered to 2026 only)
    const projects = await getESSProjects();

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
    message += `**Board:** MLB 2026 ESS\n`;
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
