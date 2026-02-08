// src/commands/mondaySyncProjects.js
import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { getESSProjects, isMondayConfigured } from '../services/mondayApi.js';
import { syncMultipleProjects, getSyncStats } from '../services/projectSyncOrchestrator.js';

/**
 * Show sync results summary
 */
async function showSyncResults(interaction, syncResults, totalCount) {
  const successful = syncResults.filter(r => r.success).length;
  const failed = syncResults.filter(r => !r.success && !r.skipped.all).length;
  const skipped = syncResults.filter(r => r.skipped.all).length;

  let message = `**Sync Complete!**\n\n`;
  message += `**Results:**\n`;
  message += `Successful: ${successful}\n`;
  message += `Failed: ${failed}\n`;
  message += `Skipped (already synced): ${skipped}\n\n`;

  message += `**Details:**\n`;
  for (const result of syncResults.slice(0, 10)) {
    message += `\n* **${result.mondayProjectName}**\n`;
    if (result.skipped.all) {
      message += `  Skipped: ${result.skipped.all}\n`;
    } else {
      if (result.created.discord) {
        if (result.created.discord.flagged) {
          message += `  Flagged: ${result.created.discord.reason}\n`;
        } else {
          const status = result.created.discord.existed ? 'Thread exists' : 'Thread created';
          message += `  Discord: ${status} in ${result.created.discord.forumName}\n`;
          if (result.created.discord.threadUrl) {
            message += `     ${result.created.discord.threadUrl}\n`;
          }
        }
      }
      if (Object.keys(result.errors).length > 0) {
        message += `  Errors: ${Object.keys(result.errors).join(', ')}\n`;
      }
    }
  }

  if (syncResults.length > 10) {
    message += `\n... and ${syncResults.length - 10} more\n`;
  }

  const stats = await getSyncStats();
  message += `\n**Overall Stats:**\n`;
  message += `Total synced all-time: ${stats.totalSynced}\n`;
  message += `Last sync: ${stats.lastSyncedAt ? new Date(stats.lastSyncedAt).toLocaleString() : 'Never'}\n`;

  if (message.length > 2000) {
    message = message.substring(0, 1950) + '\n\n... (truncated)';
  }

  await interaction.editReply({ content: message });
}

export const data = new SlashCommandBuilder()
  .setName('monday-sync-projects')
  .setDescription('Sync new Monday.com ESS projects to Discord')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(option =>
    option
      .setName('mode')
      .setDescription('Sync mode')
      .setRequired(false)
      .addChoices(
        { name: 'New only (since last sync)', value: 'new' },
        { name: 'Last 24 hours', value: '24h' },
        { name: 'Last 7 days', value: '7d' },
        { name: 'All time', value: 'all' },
        { name: 'Test (dry run - no actual changes)', value: 'test' }
      )
  )
  .addIntegerOption(option =>
    option
      .setName('limit')
      .setDescription('Max number of projects to sync (default: 10)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100)
  );

export async function execute(interaction, discordClient) {
  const mode = interaction.options.getString('mode') || 'new';
  const limit = interaction.options.getInteger('limit') || 10;

  if (!isMondayConfigured()) {
    return interaction.reply({
      content: 'Monday.com is not configured. Please set MONDAY_API_TOKEN in .env file.',
      flags: 64
    });
  }

  await interaction.deferReply({ flags: 64 });

  try {
    console.log(`[monday-sync] Starting sync in mode: ${mode}`);

    const boardSelectionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('board_2025')
          .setLabel('2025 ESS only')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('board_2026')
          .setLabel('MLB 2026 ESS only')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('board_both')
          .setLabel('Both boards')
          .setStyle(ButtonStyle.Success)
      );

    await interaction.editReply({
      content: `**Monday.com Project Sync**\n\nWhich board(s) would you like to sync?`,
      components: [boardSelectionRow]
    });

    const filter = i => i.user.id === interaction.user.id;
    const boardCollector = interaction.channel.createMessageComponentCollector({
      filter,
      time: 60000,
      max: 1
    });

    boardCollector.on('collect', async boardInteraction => {
      const selectedBoards = boardInteraction.customId === 'board_2025' ? ['2025 ESS'] :
                             boardInteraction.customId === 'board_2026' ? ['MLB 2026 ESS'] :
                             ['2025 ESS', 'MLB 2026 ESS'];

      await boardInteraction.update({
        content: `Fetching projects from ${selectedBoards.join(' and ')}...`,
        components: []
      });

      let createdSince = null;
      if (mode === '24h') {
        createdSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      } else if (mode === '7d') {
        createdSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      }

      const allProjects = await getESSProjects({ createdSince });
      const mondayProjects = allProjects.filter(p => selectedBoards.includes(p.boardName));

      if (mondayProjects.length === 0) {
        return boardInteraction.editReply({
          content: `No projects found in ${selectedBoards.join(' and ')}.`
        });
      }

      const projectsToSync = mondayProjects.slice(0, limit);

      let message = `**Monday.com Project Sync Preview**\n\n`;
      message += `Board(s): **${selectedBoards.join(', ')}**\n`;
      message += `Found ${mondayProjects.length} projects`;
      if (createdSince) {
        message += ` created since ${createdSince.toLocaleDateString()}`;
      }
      message += `\nShowing ${projectsToSync.length} projects:\n\n`;

      for (let i = 0; i < Math.min(10, projectsToSync.length); i++) {
        const p = projectsToSync[i];
        message += `${i + 1}. **${p.name}**\n`;
        message += `   Board: ${p.boardName} | Sage: ${p.sageNumber || 'N/A'} | ${p.city}, ${p.state}\n`;
      }

      if (projectsToSync.length > 10) {
        message += `\n... and ${projectsToSync.length - 10} more\n`;
      }

      message += `\n**What would you like to do?**`;

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('sync_all')
            .setLabel(`Create All (${projectsToSync.length})`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('sync_select')
            .setLabel('Select Individual')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('sync_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );

      await boardInteraction.editReply({
        content: message,
        components: [row]
      });

      const actionCollector = interaction.channel.createMessageComponentCollector({
        filter,
        time: 60000
      });

      actionCollector.on('collect', async i => {
        if (i.customId === 'sync_cancel') {
          actionCollector.stop();
          await i.update({
            content: 'Sync cancelled.',
            components: []
          });
          return;
        }

        if (i.customId === 'sync_all') {
          actionCollector.stop();
          await i.update({
            content: `Creating Discord threads for ${projectsToSync.length} projects...\n\n*This may take a few moments...*`,
            components: []
          });

          const syncResults = await syncMultipleProjects(projectsToSync, {
            discordClient: discordClient,
            createInDiscord: true,
            force: false
          });

          await showSyncResults(i, syncResults, projectsToSync.length);
          return;
        }

        if (i.customId === 'sync_select') {
          const selectOptions = projectsToSync.slice(0, 25).map((p, idx) => ({
            label: p.name.substring(0, 100),
            value: `project_${idx}`,
            description: `${p.boardName} | ${p.city}, ${p.state}`.substring(0, 100)
          }));

          const selectMenu = new ActionRowBuilder()
            .addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('project_select')
                .setPlaceholder('Select projects to sync')
                .setMinValues(1)
                .setMaxValues(selectOptions.length)
                .addOptions(selectOptions)
            );

          const confirmRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('sync_selected')
                .setLabel('Create Selected')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId('sync_cancel_2')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
            );

          await i.update({
            content: `**Select which projects to sync:**\n\n*You can select multiple projects from the dropdown.*`,
            components: [selectMenu, confirmRow]
          });
        }

        if (i.customId === 'sync_selected') {
          const selectedValues = i.message.components[0].components[0].data.values || [];

          if (selectedValues.length === 0) {
            await i.reply({
              content: 'No projects selected. Please select at least one project.',
              ephemeral: true
            });
            return;
          }

          actionCollector.stop();

          const selectedProjects = selectedValues.map(val => {
            const idx = parseInt(val.replace('project_', ''));
            return projectsToSync[idx];
          });

          await i.update({
            content: `Creating Discord threads for ${selectedProjects.length} selected projects...\n\n*This may take a few moments...*`,
            components: []
          });

          const syncResults = await syncMultipleProjects(selectedProjects, {
            discordClient: discordClient,
            createInDiscord: true,
            force: false
          });

          await showSyncResults(i, syncResults, selectedProjects.length);
          return;
        }

        if (i.customId === 'sync_cancel_2') {
          actionCollector.stop();
          await i.update({
            content: 'Sync cancelled.',
            components: []
          });
          return;
        }

        if (i.customId === 'project_select') {
          await i.deferUpdate();
        }
      });

      actionCollector.on('end', collected => {
        if (collected.size === 0) {
          interaction.editReply({
            content: 'Sync timed out after 60 seconds. Please run the command again.',
            components: []
          });
        }
      });
    });

    boardCollector.on('end', collected => {
      if (collected.size === 0) {
        interaction.editReply({
          content: 'Board selection timed out after 60 seconds. Please run the command again.',
          components: []
        });
      }
    });

  } catch (error) {
    console.error('[monday-sync] Error:', error);
    return interaction.editReply({
      content: `Failed to sync Monday.com projects: ${error.message || 'Unknown error'}\n\nPlease check logs for details.`,
    });
  }
}
