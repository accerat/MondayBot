// src/index.js
// MondayBot - Bidirectional sync between Monday.com and Discord
import 'dotenv/config';
import { Client, GatewayIntentBits, Events, Partials, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { initializeWeeklySummary } from './jobs/weeklySummary.js';
import { initializeDailySync } from './jobs/dailySync.js';
import { initializeHealthMonitor } from './services/healthMonitor.js';
import { initializeCrewMapping } from './services/crewMapping.js';
import { initializeCommentReconciler } from './jobs/commentReconciler.js';
import { addUpdate } from './services/mondayApi.js';
import schedulerRoutes, { setClient as setSchedulerClient } from './http/schedulerRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== Discord Bot Setup ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// Load commands
const commandMap = new Map();
const commandsPath = join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = join(commandsPath, file);
  const command = await import(`file://${filePath}`);
  if (command.data && command.execute) {
    commandMap.set(command.data.name, command);
  }
}

// Handle slash commands, buttons, and modals
client.on(Events.InteractionCreate, async interaction => {
  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {
    const command = commandMap.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error('[MondayBot] Command error:', error);
      try {
        const errorMessage = {
          content: 'An error occurred while executing this command.',
          flags: 64 // EPHEMERAL
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (replyError) {
        console.error('[MondayBot] Could not send error reply:', replyError.code);
      }
    }
    return;
  }

  // --- Reply button → show modal ---
  if (interaction.isButton() && interaction.customId.startsWith('monday_reply_')) {
    const itemId = interaction.customId.replace('monday_reply_', '');
    try {
      const modal = new ModalBuilder()
        .setCustomId(`monday_reply_modal_${itemId}`)
        .setTitle('Reply to Monday.com');

      const replyInput = new TextInputBuilder()
        .setCustomId('reply_text')
        .setLabel('Your reply')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Type your reply here...')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(replyInput));
      await interaction.showModal(modal);
    } catch (error) {
      console.error('[MondayBot] Error showing reply modal:', error);
    }
    return;
  }

  // --- Modal submit → forward reply to Monday.com ---
  if (interaction.isModalSubmit() && interaction.customId.startsWith('monday_reply_modal_')) {
    const itemId = interaction.customId.replace('monday_reply_modal_', '');
    const replyText = interaction.fields.getTextInputValue('reply_text');

    try {
      await interaction.deferReply({ flags: 64 }); // ephemeral

      const updateText = `**From ${interaction.user.displayName} (Discord):**\n${replyText}`;
      await addUpdate(itemId, updateText);

      await interaction.editReply('✅ Reply posted to Monday.com');

      // Also post the reply visibly in the thread
      await interaction.channel.send(
        `💬 **Reply from ${interaction.user.displayName}**\n>>> ${replyText}`
      );

      console.log(`[MondayBot] Reply forwarded to Monday item ${itemId} from ${interaction.user.displayName}`);
    } catch (error) {
      console.error('[MondayBot] Error forwarding reply:', error);
      try {
        await interaction.editReply('❌ Failed to post reply to Monday.com');
      } catch {}
    }
    return;
  }
});

// Handle @MondayBot mentions
client.on(Events.MessageCreate, async message => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check if bot is mentioned
  if (!message.mentions.has(client.user)) return;

  try {
    // Import mention handler
    const { handleMondayBotMention } = await import('./services/mondayMentionHandler.js');
    await handleMondayBotMention(message);
  } catch (error) {
    console.error('[MondayBot] Error handling mention:', error);
    await message.reply('❌ Sorry, I encountered an error processing your request.');
  }
});

client.once(Events.ClientReady, c => {
  console.log(`[MondayBot] Logged in as ${c.user.tag}`);
  console.log('[MondayBot] Ready to sync Monday.com and Discord');

  // Initialize crew mapping (loads from Google Drive)
  initializeCrewMapping().catch(err =>
    console.error('[MondayBot] Failed to initialize crew mapping:', err.message)
  );

  // Initialize scheduled jobs and health monitoring
  initializeWeeklySummary(client);
  initializeDailySync(client);
  initializeHealthMonitor(client);
  initializeCommentReconciler(client);

  // Set Discord client for scheduler HTTP endpoints
  setSchedulerClient(client);
});

client.login(process.env.BOT_TOKEN);

// ==================== Express Webhook Server ====================

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3001;

// Parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bot: client.user ? client.user.tag : 'not ready',
    timestamp: new Date().toISOString()
  });
});

// Scheduler endpoints
app.use('/scheduler', schedulerRoutes);

// Monday.com webhook endpoint
app.post('/webhook/monday', async (req, res) => {
  try {
    // Handle Monday.com challenge verification
    if (req.body.challenge) {
      console.log('[Webhook] Responding to Monday.com challenge');
      return res.status(200).json({ challenge: req.body.challenge });
    }

    console.log('[Webhook] Received Monday.com webhook');

    // Import webhook handler
    const { handleMondayWebhook } = await import('./services/mondayWebhook.js');
    await handleMondayWebhook(req.body, client);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Webhook] Error processing Monday.com webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start webhook server
app.listen(PORT, () => {
  console.log(`[MondayBot] Webhook server listening on port ${PORT}`);
  console.log(`[MondayBot] Webhook URL: http://localhost:${PORT}/webhook/monday`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[MondayBot] Shutting down...');
  client.destroy();
  process.exit(0);
});
