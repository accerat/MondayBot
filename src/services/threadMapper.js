// src/services/threadMapper.js
// Maps Monday.com item IDs to Discord thread IDs
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAPPING_FILE = path.join(__dirname, '../../data/thread-mapping.json');

/**
 * Load thread mapping from disk
 */
async function loadMapping() {
  try {
    await fs.mkdir(path.dirname(MAPPING_FILE), { recursive: true });
    const data = await fs.readFile(MAPPING_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { mappings: {} };
    }
    throw error;
  }
}

/**
 * Save thread mapping to disk
 */
async function saveMapping(mapping) {
  await fs.mkdir(path.dirname(MAPPING_FILE), { recursive: true });
  await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf8');
}

/**
 * Get Discord thread ID for a Monday.com item ID
 */
export async function getThreadId(mondayItemId) {
  const mapping = await loadMapping();
  return mapping.mappings[mondayItemId] || null;
}

/**
 * Map a Monday.com item ID to a Discord thread ID
 */
export async function mapThread(mondayItemId, threadId, projectName) {
  const mapping = await loadMapping();
  mapping.mappings[mondayItemId] = {
    threadId,
    projectName,
    mappedAt: new Date().toISOString()
  };
  await saveMapping(mapping);
  console.log(`[ThreadMapper] Mapped Monday item ${mondayItemId} to Discord thread ${threadId}`);
}

/**
 * Find thread by searching Discord forums
 * (Called when we receive a webhook for an item we haven't mapped yet)
 */
export async function findThreadByMondayId(mondayItemId, discordClient) {
  try {
    const PROJECTS_CATEGORY_ID = process.env.PROJECTS_CATEGORY_ID;
    const GUILD_ID = process.env.GUILD_ID;

    const guild = await discordClient.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();

    // Find all forum channels in the category
    const forums = guild.channels.cache.filter(
      channel => channel.parentId === PROJECTS_CATEGORY_ID && channel.type === 15
    );

    // Search through all threads in all forums
    for (const [, forum] of forums) {
      const activeThreads = await forum.threads.fetchActive();
      const archivedThreads = await forum.threads.fetchArchived();

      // Check active threads
      for (const [, thread] of activeThreads.threads) {
        // Fetch first message to check for Monday item ID
        const messages = await thread.messages.fetch({ limit: 1 });
        const firstMessage = messages.first();

        if (firstMessage && firstMessage.content.includes(`Monday Item ID: ${mondayItemId}`)) {
          return thread.id;
        }
      }

      // Check archived threads
      for (const [, thread] of archivedThreads.threads) {
        const messages = await thread.messages.fetch({ limit: 1 });
        const firstMessage = messages.first();

        if (firstMessage && firstMessage.content.includes(`Monday Item ID: ${mondayItemId}`)) {
          return thread.id;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('[ThreadMapper] Error finding thread:', error);
    return null;
  }
}

/**
 * Get Monday.com item ID from Discord thread ID (reverse lookup)
 */
export async function getMondayItemIdFromThread(threadId) {
  const mapping = await loadMapping();
  for (const [mondayItemId, data] of Object.entries(mapping.mappings)) {
    if (data.threadId === threadId) {
      return mondayItemId;
    }
  }
  return null;
}

/**
 * Get all mappings (for debugging)
 */
export async function getAllMappings() {
  const mapping = await loadMapping();
  return mapping.mappings;
}
