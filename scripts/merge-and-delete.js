// scripts/merge-and-delete.js
// Merge messages from duplicate threads into the keeper, then delete the duplicate
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAPPING_FILE = path.join(__dirname, '../data/thread-mapping.json');

// [keepThreadId, deleteThreadId, projectName]
const MERGE_PAIRS = [
  ['1472969253006217306', '1474390217069826303', '1492.1003 Aurora, CO'],
  ['1472969869623562431', '1474390214196596932', '5334.1002 Aurora, CO'],
  ['1472969605495525448', '1474390214880399531', '980.1005 Greeley, CO'],
  ['1469402819025965076', '1470766461353066496', '430.1003 Mayfield, KY'],
  ['1462796436503658654', '1470766375965298759', '780.1003 Monroe, GA'],
  ['1456320522290991155', '1462808043292066027', '3403.1010 Dallas, GA'],
];

async function fetchAllMessages(thread) {
  const messages = [];
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await thread.messages.fetch(options);
    if (batch.size === 0) break;

    messages.push(...batch.values());
    lastId = batch.last().id;
  }

  // Return oldest first
  return messages.reverse();
}

async function main() {
  console.log(`\n=== Merge & Delete Duplicate Threads ===\n`);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await client.login(process.env.BOT_TOKEN);
  await new Promise(resolve => client.once('ready', resolve));
  console.log(`Logged in as ${client.user.tag}\n`);

  for (const [keepId, deleteId, name] of MERGE_PAIRS) {
    console.log(`--- ${name} ---`);
    console.log(`  Keep:   ${keepId}`);
    console.log(`  Delete: ${deleteId}`);

    try {
      const keepThread = await client.channels.fetch(keepId);
      const deleteThread = await client.channels.fetch(deleteId);

      if (!keepThread || !deleteThread) {
        console.log(`  ERROR: Could not fetch one or both threads, skipping`);
        continue;
      }

      // Fetch all messages from the thread to delete
      const messages = await fetchAllMessages(deleteThread);

      // Filter out the bot's own starter message (first message in a forum thread)
      // We only want to merge user messages and non-starter bot messages
      const toMerge = messages.filter(msg => {
        // Skip the initial auto-created thread message from the bot
        if (msg.id === deleteThread.id) return false;
        // Skip empty messages
        if (!msg.content && msg.embeds.length === 0 && msg.attachments.size === 0) return false;
        return true;
      });

      console.log(`  Found ${messages.length} total messages, ${toMerge.length} to merge`);

      if (toMerge.length > 0) {
        await keepThread.send(`--- **Merged from duplicate thread** (created ${deleteThread.createdAt.toLocaleDateString()}) ---`);

        for (const msg of toMerge) {
          const author = msg.author?.username || 'Unknown';
          const timestamp = msg.createdAt.toLocaleString();
          let content = '';

          // Add author attribution
          content += `**${author}** (${timestamp}):\n`;

          if (msg.content) {
            content += msg.content;
          }

          // Handle attachments
          if (msg.attachments.size > 0) {
            for (const [, att] of msg.attachments) {
              content += `\n[Attachment: ${att.name}](${att.url})`;
            }
          }

          if (content.length > 2000) {
            content = content.substring(0, 1997) + '...';
          }

          await keepThread.send(content);
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        await keepThread.send(`--- **End of merged messages** ---`);
      }

      // Delete the duplicate thread
      await deleteThread.delete('Cleanup: merged messages and removing duplicate');
      console.log(`  MERGED ${toMerge.length} messages and DELETED duplicate\n`);

    } catch (error) {
      console.error(`  ERROR: ${error.message}\n`);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Clean up thread-mapping.json - remove entries pointing to deleted threads
  console.log(`--- Cleaning thread-mapping.json ---`);
  const deleteIds = new Set(MERGE_PAIRS.map(p => p[1]));
  try {
    const data = await fs.readFile(MAPPING_FILE, 'utf8');
    const mapping = JSON.parse(data);
    let removed = 0;

    for (const [mondayId, entry] of Object.entries(mapping.mappings)) {
      if (deleteIds.has(entry.threadId)) {
        console.log(`  Removing stale mapping: ${entry.projectName} -> ${entry.threadId}`);
        delete mapping.mappings[mondayId];
        removed++;
      }
    }

    mapping.lastUpdated = new Date().toISOString();
    await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf8');
    console.log(`  Removed ${removed} stale mappings`);
  } catch (error) {
    console.error(`  Error updating mapping: ${error.message}`);
  }

  console.log(`\n=== Done ===`);
  client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
