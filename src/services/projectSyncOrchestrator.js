// src/services/projectSyncOrchestrator.js
// Orchestrates project creation in Discord (simplified version for MondayBot)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { mapThread, getThreadId } from './threadMapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory cache for forum channels (persists across sync batch)
const forumChannelCache = new Map();

/**
 * Determine the target Discord channel based on the Branch column value.
 * Returns { channelId, flagged, reason } where flagged=true means item needs attention.
 *
 * Since items are pre-filtered by group (non-ESS excluded), we default to ESS channel
 * unless Branch explicitly says "OPD".
 */
function getBranchChannelId(projectData) {
  // Known Branch column IDs (dropdown type)
  // MLB 2026 ESS board: dropdown_mm07kqx
  const branchColumnIds = ['dropdown_mm07kqx'];

  // Look for branch column by known ID first
  let branchCol = null;
  for (const colId of branchColumnIds) {
    if (projectData.rawColumns && projectData.rawColumns[colId]) {
      branchCol = [colId, projectData.rawColumns[colId]];
      break;
    }
  }

  // Fallback: look for any column with "branch" in ID or dropdown columns with ESS/OPD values
  if (!branchCol) {
    branchCol = Object.entries(projectData.rawColumns || {}).find(([id, col]) => {
      return id.toLowerCase().includes('branch') ||
             (col.text && (col.text.toLowerCase() === 'ess' || col.text.toLowerCase() === 'opd'));
    });
  }

  // Get branch value, default to ESS if empty (since non-ESS group is filtered out at API level)
  const branchText = branchCol?.[1]?.text?.trim() || '';

  if (!branchText) {
    // No branch set - default to ESS since we filtered out non-ESS group
    console.log(`[sync] No branch value for "${projectData.name}", defaulting to ESS`);
    return { channelId: process.env.ESS_CHANNEL_ID, flagged: false, reason: null };
  }

  console.log(`[sync] Branch for "${projectData.name}": "${branchText}"`);

  const values = branchText.split(',').map(v => v.trim()).filter(Boolean);

  if (values.length > 1) {
    // Multiple branches - use first one, prefer ESS
    const hasESS = values.some(v => v.toLowerCase() === 'ess');
    const hasOPD = values.some(v => v.toLowerCase() === 'opd');
    if (hasOPD && !hasESS) {
      return { channelId: process.env.OPD_CHANNEL_ID, flagged: false, reason: null };
    }
    // Default to ESS for multiple branches
    console.log(`[sync] Multiple branches for "${projectData.name}", defaulting to ESS`);
    return { channelId: process.env.ESS_CHANNEL_ID, flagged: false, reason: null };
  }

  const branch = values[0].toLowerCase();
  if (branch === 'opd') {
    return { channelId: process.env.OPD_CHANNEL_ID, flagged: false, reason: null };
  } else {
    // ESS or any other value - use ESS channel
    return { channelId: process.env.ESS_CHANNEL_ID, flagged: false, reason: null };
  }
}

/**
 * Find or create a forum channel in a category
 */
async function findOrCreateForumChannel(guild, categoryId, forumName) {
  try {
    console.log(`[sync-discord] Finding/creating forum: "${forumName}" in category: ${categoryId}`);

    const normalizedForumName = forumName.toLowerCase().replace(/\s+/g, '-');
    const cacheKey = `${categoryId}:${normalizedForumName}`;

    if (forumChannelCache.has(cacheKey)) {
      const cachedForum = forumChannelCache.get(cacheKey);
      console.log(`[sync-discord] Found forum in cache: "${forumName}" (ID: ${cachedForum.id})`);
      return cachedForum;
    }

    const category = await guild.channels.fetch(categoryId);
    if (!category) {
      throw new Error(`Category ${categoryId} not found`);
    }

    await guild.channels.fetch();

    const existingForum = guild.channels.cache.find(
      channel =>
        channel.parentId === categoryId &&
        channel.type === 15 && // GUILD_FORUM
        channel.name === normalizedForumName
    );

    if (existingForum) {
      console.log(`[sync-discord] Found existing forum: "${forumName}" (ID: ${existingForum.id})`);
      forumChannelCache.set(cacheKey, existingForum);
      return existingForum;
    }

    console.log(`[sync-discord] Creating new forum channel: "${forumName}"...`);
    const newForum = await guild.channels.create({
      name: forumName,
      type: 15, // GUILD_FORUM
      parent: categoryId,
      reason: `Auto-created for Monday.com ${forumName} projects`
    });

    console.log(`[sync-discord] Created forum: "${newForum.name}" (ID: ${newForum.id})`);
    forumChannelCache.set(cacheKey, newForum);

    return newForum;
  } catch (error) {
    console.error(`[sync-discord] Error finding/creating forum channel "${forumName}":`, error.message);
    throw error;
  }
}

/**
 * Create Discord thread for a project
 */
async function createDiscordThread(projectData, discordClient) {
  if (!discordClient) {
    throw new Error('Discord client not provided');
  }

  // Determine channel based on branch
  const branchResult = getBranchChannelId(projectData);

  // If flagged (no valid branch), send to flag channel
  if (branchResult.flagged) {
    const flagChannelId = process.env.FLAG_CHANNEL_ID;
    if (flagChannelId) {
      try {
        const flagChannel = await discordClient.channels.fetch(flagChannelId);
        if (flagChannel) {
          const branchCol = Object.entries(projectData.rawColumns || {}).find(([id]) =>
            id.toLowerCase().includes('branch') || id === 'dropdown_mm07kqx'
          );
          const branchValues = branchCol?.[1]?.text || '(empty)';
          await flagChannel.send(`⚠️ **Branch Issue** - Item "${projectData.name}" (ID: \`${projectData.mondayItemId}\`)\n**Reason:** ${branchResult.reason}\n**Current Branch Value:** ${branchValues}\n\nPlease set a valid branch (ESS or OPD) in Monday.com. The Discord thread will be created automatically once fixed.`);
        }
      } catch (e) {
        console.error('[sync-discord] Error flagging branch issue:', e);
      }
    }
    return {
      created: false,
      existed: false,
      flagged: true,
      reason: branchResult.reason
    };
  }

  let forumChannelId = branchResult.channelId;

  // Fallback to PROJECTS_CATEGORY_ID if no branch channel configured
  if (!forumChannelId) {
    forumChannelId = process.env.PROJECTS_CATEGORY_ID;
  }

  if (!forumChannelId) {
    throw new Error('No channel ID configured for project sync');
  }

  try {
    console.log(`[sync-discord] Creating thread for: "${projectData.name}"`);

    const guildId = process.env.GUILD_ID;
    const guild = await discordClient.guilds.fetch(guildId);

    // Try to fetch as forum channel directly first
    let forum;
    try {
      forum = await discordClient.channels.fetch(forumChannelId);
      if (!forum.isThreadOnly || !forum.isThreadOnly()) {
        // It's a category, find/create forum within it
        const forumName = projectData.boardName;
        forum = await findOrCreateForumChannel(guild, forumChannelId, forumName);
      }
    } catch (e) {
      // Fallback: treat as category ID
      const forumName = projectData.boardName;
      forum = await findOrCreateForumChannel(guild, forumChannelId, forumName);
    }

    // Check if thread already exists
    const existingThreads = await forum.threads.fetchActive();
    const existingThread = existingThreads.threads.find(t => t.name === projectData.name);

    if (existingThread) {
      console.log(`[sync-discord] Thread already exists: "${projectData.name}"`);
      return {
        created: false,
        existed: true,
        threadId: existingThread.id,
        threadUrl: existingThread.url,
        forumName: forum.name
      };
    }

    const messageContent = formatProjectMessage(projectData);

    const thread = await forum.threads.create({
      name: projectData.name,
      message: { content: messageContent },
      reason: `Auto-created from Monday.com ${projectData.boardName}`
    });

    console.log(`[sync-discord] Created thread: "${thread.name}" (ID: ${thread.id})`);

    // Map the thread
    await mapThread(projectData.mondayItemId, thread.id, projectData.name);

    return {
      created: true,
      existed: false,
      threadId: thread.id,
      threadUrl: thread.url,
      forumName: forum.name
    };
  } catch (error) {
    console.error(`[sync-discord] Error creating thread:`, error);
    throw error;
  }
}

/**
 * Format project data into a Discord message
 */
function formatProjectMessage(project) {
  const lines = [];

  lines.push(`# ${project.name}\n`);

  if (project.sageNumber) {
    lines.push(`**Sage #:** ${project.sageNumber}`);
  }

  if (project.location) {
    if (project.location.address) {
      lines.push(`**Address:** ${project.location.address}`);
    }
    if (project.location.lat && project.location.lng) {
      lines.push(`**GPS:** ${project.location.lat}, ${project.location.lng}`);
      lines.push(`**Map:** https://www.google.com/maps?q=${project.location.lat},${project.location.lng}`);
    }
  } else if (project.city || project.state) {
    lines.push(`**Location:** ${project.city}, ${project.state}`);
  }

  if (project.superintendent) {
    lines.push(`**Superintendent:** ${project.superintendent}`);
  }

  if (project.crew) {
    lines.push(`**Crew:** ${project.crew}`);
  }

  if (project.status) {
    lines.push(`**Status:** ${project.status}`);
  }

  if (project.timeline) {
    const from = project.timeline.from ? new Date(project.timeline.from).toLocaleDateString() : 'Not set';
    const to = project.timeline.to ? new Date(project.timeline.to).toLocaleDateString() : 'Not set';
    lines.push(`\n**Timeline:** ${from} → ${to}`);
  }

  if (project.uhcCSD || project.walCSD || project.endDate) {
    lines.push(`\n**Key Dates:**`);
    if (project.uhcCSD) lines.push(`- UHC CSD: ${project.uhcCSD}`);
    if (project.walCSD) lines.push(`- WAL CSD: ${project.walCSD}`);
    if (project.endDate) lines.push(`- End Date: ${project.endDate}`);
  }

  if (project.mlbSow) {
    lines.push(`\n**MLB SOW:**`);
    lines.push(`\`\`\`\n${project.mlbSow}\n\`\`\``);
  }

  if (project.materialQuantities) {
    lines.push(`\n**Material Quantities:**`);
    lines.push(`\`\`\`\n${project.materialQuantities}\n\`\`\``);
  }

  if (project.materialNotes) {
    lines.push(`\n**Material Notes:** ${project.materialNotes}`);
  }

  lines.push(`\n---`);
  lines.push(`*Auto-created from Monday.com ${project.boardName}*`);
  lines.push(`*Monday Item ID: ${project.mondayItemId}*`);

  return lines.join('\n');
}

// Path to store sync state
const SYNC_STATE_PATH = path.join(__dirname, '../../data/project-sync-state.json');

/**
 * Load sync state from disk
 */
async function loadSyncState() {
  try {
    await fs.mkdir(path.dirname(SYNC_STATE_PATH), { recursive: true });
    const data = await fs.readFile(SYNC_STATE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { syncedProjects: {} };
    }
    throw error;
  }
}

/**
 * Save sync state to disk
 */
async function saveSyncState(state) {
  await fs.mkdir(path.dirname(SYNC_STATE_PATH), { recursive: true });
  await fs.writeFile(SYNC_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Check if a project has already been synced
 * Checks both project-sync-state.json AND thread-mapping.json
 */
async function isProjectSynced(mondayItemId) {
  // First check thread-mapping.json (existing threads from webhooks or old TaskBot)
  const existingThread = await getThreadId(mondayItemId);
  if (existingThread) {
    return true;
  }

  // Then check project-sync-state.json (projects synced via this command)
  const state = await loadSyncState();
  return !!state.syncedProjects[mondayItemId];
}

/**
 * Mark a project as synced
 */
async function markProjectSynced(mondayItemId, syncDetails) {
  const state = await loadSyncState();
  state.syncedProjects[mondayItemId] = {
    ...syncDetails,
    syncedAt: new Date().toISOString()
  };
  await saveSyncState(state);
}

/**
 * Sync a Monday.com project to Discord
 */
export async function syncProjectToAllSystems(mondayProject, options = {}) {
  const {
    discordClient,
    createInDiscord = true,
    force = false
  } = options;

  const results = {
    mondayItemId: mondayProject.mondayItemId,
    mondayProjectName: mondayProject.name,
    success: false,
    created: {},
    errors: {},
    skipped: {}
  };

  try {
    if (!force && await isProjectSynced(mondayProject.mondayItemId)) {
      console.log(`[sync] Project ${mondayProject.name} already synced, skipping`);
      results.skipped.all = 'Already synced';
      return results;
    }

    console.log(`[sync] Starting sync for project: ${mondayProject.name}`);

    if (createInDiscord) {
      try {
        const discordResult = await createDiscordThread(mondayProject, discordClient);
        results.created.discord = discordResult;

        // If flagged (no thread created), don't mark as synced
        if (discordResult.flagged) {
          console.log(`[sync] Project ${mondayProject.name} flagged: ${discordResult.reason}, not marking as synced`);
          results.success = false;
          return results;
        }
      } catch (error) {
        console.error('[sync] Discord thread creation failed:', error);
        results.errors.discord = error.message;
      }
    }

    // Only mark as synced if a thread was actually created or exists
    const discordResult = results.created.discord;
    if (discordResult && (discordResult.created || discordResult.existed)) {
      await markProjectSynced(mondayProject.mondayItemId, {
        projectName: mondayProject.name,
        sageNumber: mondayProject.sageNumber,
        created: results.created,
        errors: results.errors
      });
    }

    results.success = Object.keys(results.errors).length === 0 && !discordResult?.flagged;
    console.log(`[sync] Sync completed for ${mondayProject.name}. Success: ${results.success}`);

    return results;
  } catch (error) {
    console.error(`[sync] Fatal error syncing project ${mondayProject.name}:`, error);
    results.errors.fatal = error.message;
    return results;
  }
}

/**
 * Sync multiple Monday.com projects
 */
export async function syncMultipleProjects(mondayProjects, options = {}) {
  const results = [];

  for (const project of mondayProjects) {
    const result = await syncProjectToAllSystems(project, options);
    results.push(result);

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}

/**
 * Get sync statistics
 */
export async function getSyncStats() {
  const state = await loadSyncState();
  const syncedProjects = Object.values(state.syncedProjects || {});

  // Also count thread mappings
  let threadMappingCount = 0;
  try {
    const mappingPath = path.join(__dirname, '../../data/thread-mapping.json');
    const mappingData = await fs.readFile(mappingPath, 'utf8');
    const mappings = JSON.parse(mappingData);
    threadMappingCount = Object.keys(mappings.mappings || {}).length;
  } catch (e) {
    // File doesn't exist or is invalid
  }

  return {
    totalSynced: Math.max(syncedProjects.length, threadMappingCount),
    threadMappings: threadMappingCount,
    successfulSyncs: syncedProjects.filter(p => !p.errors || Object.keys(p.errors).length === 0).length,
    failedSyncs: syncedProjects.filter(p => p.errors && Object.keys(p.errors).length > 0).length,
    lastSyncedAt: syncedProjects.length > 0 ? syncedProjects[syncedProjects.length - 1].syncedAt : null
  };
}
