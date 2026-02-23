// src/commands/mondayFindDuplicates.js
// Command to find duplicate threads in project forum channels

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('monday-find-duplicates')
  .setDescription('Find duplicate thread names in ESS/OPD forum channels')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction, discordClient) {
  await interaction.deferReply({ flags: 64 });

  try {
    await interaction.editReply({ content: 'Scanning forum channels for duplicate threads...' });

    const channelIds = [
      { id: process.env.ESS_CHANNEL_ID, name: 'ESS' },
      { id: process.env.OPD_CHANNEL_ID, name: 'OPD' },
    ].filter(c => c.id);

    const allDuplicates = [];

    for (const { id, name } of channelIds) {
      const forum = await discordClient.channels.fetch(id);
      if (!forum || !forum.isThreadOnly()) continue;

      // Gather all threads (active + archived)
      const threads = new Map();

      const activeThreads = await forum.threads.fetchActive();
      for (const [, thread] of activeThreads.threads) {
        if (!threads.has(thread.name)) {
          threads.set(thread.name, []);
        }
        threads.get(thread.name).push({
          id: thread.id,
          name: thread.name,
          archived: thread.archived,
          createdAt: thread.createdTimestamp,
          messageCount: thread.messageCount || 0,
          channel: name,
        });
      }

      const archivedThreads = await forum.threads.fetchArchived();
      for (const [, thread] of archivedThreads.threads) {
        if (!threads.has(thread.name)) {
          threads.set(thread.name, []);
        }
        threads.get(thread.name).push({
          id: thread.id,
          name: thread.name,
          archived: thread.archived,
          createdAt: thread.createdTimestamp,
          messageCount: thread.messageCount || 0,
          channel: name,
        });
      }

      // Find names with more than one thread
      for (const [threadName, threadList] of threads) {
        if (threadList.length > 1) {
          allDuplicates.push({ threadName, threads: threadList });
        }
      }
    }

    if (allDuplicates.length === 0) {
      await interaction.editReply({ content: 'No duplicate threads found.' });
      return;
    }

    let message = `**Duplicate Threads Found: ${allDuplicates.length} sets**\n\n`;

    for (const dup of allDuplicates) {
      message += `**"${dup.threadName}"** (${dup.threads.length} copies)\n`;
      for (const t of dup.threads) {
        const date = new Date(t.createdAt).toLocaleDateString();
        const status = t.archived ? 'archived' : 'active';
        message += `  - <#${t.id}> | ID: \`${t.id}\` | ${t.messageCount} msgs | ${status} | ${date} | ${t.channel}\n`;
      }
      message += '\n';
    }

    // Discord message limit
    if (message.length > 2000) {
      // Split into multiple messages via follow-ups
      const chunks = [];
      let current = `**Duplicate Threads Found: ${allDuplicates.length} sets**\n\n`;

      for (const dup of allDuplicates) {
        let entry = `**"${dup.threadName}"** (${dup.threads.length} copies)\n`;
        for (const t of dup.threads) {
          const date = new Date(t.createdAt).toLocaleDateString();
          const status = t.archived ? 'archived' : 'active';
          entry += `  - <#${t.id}> | ID: \`${t.id}\` | ${t.messageCount} msgs | ${status} | ${date} | ${t.channel}\n`;
        }
        entry += '\n';

        if (current.length + entry.length > 1900) {
          chunks.push(current);
          current = '';
        }
        current += entry;
      }
      if (current) chunks.push(current);

      await interaction.editReply({ content: chunks[0] });
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], flags: 64 });
      }
    } else {
      await interaction.editReply({ content: message });
    }

  } catch (error) {
    console.error('[monday-find-duplicates] Error:', error);
    await interaction.editReply({ content: `Error: ${error.message}` });
  }
}
