// scripts/remap-threads.js
// Scan all threads in ESS/OPD forums and match them to Monday items by name.
// Creates missing entries in thread-mapping.json.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAPPING_FILE = path.join(__dirname, '../data/thread-mapping.json');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = '18392974573'; // MLB 2026 ESS

async function mondayRequest(query, variables = {}) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': process.env.MONDAY_API_TOKEN,
      'Content-Type': 'application/json',
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function fetchAllMondayItems() {
  const items = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const query = `query ($boardId: [ID!], $cursor: String) {
      boards(ids: $boardId) {
        items_page(limit: 100, cursor: $cursor) {
          cursor
          items {
            id
            name
            group { id title }
          }
        }
      }
    }`;

    const data = await mondayRequest(query, { boardId: [BOARD_ID], cursor });
    const board = data.boards[0];
    if (!board) break;

    const batch = board.items_page.items || [];
    // Exclude non-ESS group
    for (const item of batch) {
      const groupTitle = item.group?.title || '';
      if (!groupTitle.toLowerCase().includes('non-ess')) {
        items.push(item);
      }
    }

    cursor = board.items_page.cursor;
    hasMore = batch.length === 100 && cursor;
  }

  return items;
}

async function fetchAllThreads(client) {
  const threads = new Map(); // name -> { id, name, archived, messageCount }

  const channelIds = [
    process.env.ESS_CHANNEL_ID,
    process.env.OPD_CHANNEL_ID,
  ].filter(Boolean);

  for (const channelId of channelIds) {
    const forum = await client.channels.fetch(channelId);
    if (!forum || !forum.isThreadOnly()) continue;

    const active = await forum.threads.fetchActive();
    for (const [, thread] of active.threads) {
      // If multiple threads have the same name, prefer the one with more messages
      const existing = threads.get(thread.name);
      if (!existing || (thread.messageCount || 0) > (existing.messageCount || 0)) {
        threads.set(thread.name, {
          id: thread.id,
          name: thread.name,
          archived: false,
          messageCount: thread.messageCount || 0,
        });
      }
    }

    const archived = await forum.threads.fetchArchived();
    for (const [, thread] of archived.threads) {
      const existing = threads.get(thread.name);
      if (!existing || (thread.messageCount || 0) > (existing.messageCount || 0)) {
        threads.set(thread.name, {
          id: thread.id,
          name: thread.name,
          archived: true,
          messageCount: thread.messageCount || 0,
        });
      }
    }
  }

  return threads;
}

async function main() {
  console.log('\n=== Remap Threads ===\n');

  // Load current mapping
  let mapping;
  try {
    const data = await fs.readFile(MAPPING_FILE, 'utf8');
    mapping = JSON.parse(data);
  } catch {
    mapping = { mappings: {} };
  }

  const existingMondayIds = new Set(Object.keys(mapping.mappings));
  console.log(`Current mappings: ${existingMondayIds.size}`);

  // Fetch Monday items
  console.log('Fetching Monday.com items...');
  const mondayItems = await fetchAllMondayItems();
  console.log(`Found ${mondayItems.length} Monday items\n`);

  // Connect to Discord and fetch threads
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  await client.login(process.env.BOT_TOKEN);
  await new Promise(resolve => client.once('ready', resolve));
  console.log(`Logged in as ${client.user.tag}`);

  console.log('Fetching Discord threads...');
  const threadsByName = await fetchAllThreads(client);
  console.log(`Found ${threadsByName.size} unique thread names\n`);

  // Match and remap
  let mapped = 0;
  let alreadyMapped = 0;
  let noMatch = 0;

  for (const item of mondayItems) {
    if (existingMondayIds.has(item.id)) {
      alreadyMapped++;
      continue;
    }

    const thread = threadsByName.get(item.name);
    if (thread) {
      mapping.mappings[item.id] = {
        threadId: thread.id,
        projectName: item.name,
        mappedAt: new Date().toISOString(),
      };
      console.log(`  MAPPED: "${item.name}" (Monday ${item.id}) -> thread ${thread.id}`);
      mapped++;
    } else {
      console.log(`  NO MATCH: "${item.name}" (Monday ${item.id})`);
      noMatch++;
    }
  }

  // Save
  mapping.lastUpdated = new Date().toISOString();
  await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf8');

  console.log(`\n=== Results ===`);
  console.log(`Already mapped: ${alreadyMapped}`);
  console.log(`Newly mapped: ${mapped}`);
  console.log(`No Discord thread found: ${noMatch}`);
  console.log(`Total mappings now: ${Object.keys(mapping.mappings).length}`);

  client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
