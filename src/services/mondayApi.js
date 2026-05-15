// src/services/mondayApi.js
// Monday.com API client for sending updates from Discord

import sharp from 'sharp';
import FormData from 'form-data';

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const MONDAY_API_URL = 'https://api.monday.com/v2';

/**
 * Make a request to Monday.com API
 */
async function mondayRequest(query, variables = {}) {
  if (!MONDAY_API_TOKEN) {
    throw new Error('MONDAY_API_TOKEN not configured');
  }

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': MONDAY_API_TOKEN,
      'Content-Type': 'application/json',
      'API-Version': '2024-10'
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();

  if (data.errors) {
    throw new Error(`Monday.com API error: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

/**
 * Add an update/comment to a Monday.com item
 */
export async function addUpdate(itemId, updateText) {
  const query = `
    mutation ($itemId: ID!, $body: String!) {
      create_update (item_id: $itemId, body: $body) {
        id
        text_body
        created_at
      }
    }
  `;

  const result = await mondayRequest(query, {
    itemId: itemId,
    body: updateText
  });

  console.log(`[MondayAPI] Added update to item ${itemId}`);
  return result.create_update;
}

/**
 * Upload a file to a Monday.com update.
 * Downloads the file from the URL, converts to JPEG, then uploads via multipart form.
 * @param {string} updateId - The Monday.com update ID to attach the file to
 * @param {string} fileUrl - URL to download the file from
 * @param {string} fileName - Name for the uploaded file
 */
export async function uploadFileToUpdate(updateId, fileUrl, fileName) {
  // Download the file and convert to JPEG
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) throw new Error(`Failed to download file: ${fileResponse.status}`);
  const rawBuffer = Buffer.from(await fileResponse.arrayBuffer());
  const fileBuffer = await sharp(rawBuffer).jpeg({ quality: 90 }).toBuffer();

  // Ensure filename ends with .jpeg
  if (!/\.jpe?g$/i.test(fileName)) {
    fileName = fileName.replace(/\.[^.]+$/, '.jpeg') || fileName + '.jpeg';
  }

  const query = `mutation ($file: File!) { add_file_to_update (update_id: ${updateId}, file: $file) { id } }`;

  // Retry up to 3 times on transient Monday.com errors (500, network failures)
  const MAX_ATTEMPTS = 3;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const form = new FormData();
      form.append('query', query);
      form.append('variables[file]', fileBuffer, {
        filename: fileName,
        contentType: 'image/jpeg',
      });

      const data = await new Promise((resolve, reject) => {
        form.submit({
          host: 'api.monday.com',
          path: '/v2/file',
          protocol: 'https:',
          headers: { 'Authorization': MONDAY_API_TOKEN },
        }, (err, res) => {
          if (err) return reject(err);
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error(`Monday.com returned non-JSON: ${body.substring(0, 200)}`)); }
          });
          res.on('error', reject);
        });
      });

      if (data.errors) {
        // Check if it's a retriable error (500, internal server error)
        const errMsg = JSON.stringify(data.errors);
        const isRetriable = errMsg.includes('500') || errMsg.includes('INTERNAL_SERVER_ERROR') || errMsg.includes('Internal server error');
        if (isRetriable && attempt < MAX_ATTEMPTS) {
          lastError = new Error(`Monday.com file upload error: ${errMsg}`);
          console.log(`[MondayAPI] Retry ${attempt}/${MAX_ATTEMPTS} for "${fileName}" after error`);
          await new Promise(r => setTimeout(r, 2000 * attempt)); // exponential backoff
          continue;
        }
        throw new Error(`Monday.com file upload error: ${errMsg}`);
      }

      console.log(`[MondayAPI] Uploaded file "${fileName}" to update ${updateId}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return data.data?.add_file_to_update;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[MondayAPI] Retry ${attempt}/${MAX_ATTEMPTS} for "${fileName}": ${err.message}`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
    }
  }
  throw lastError;
}

/**
 * Change a column value on a Monday.com item
 */
export async function updateColumn(boardId, itemId, columnId, value) {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_simple_column_value (
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) {
        id
      }
    }
  `;

  const result = await mondayRequest(query, {
    boardId: boardId,
    itemId: itemId,
    columnId: columnId,
    value: JSON.stringify(value)
  });

  console.log(`[MondayAPI] Updated column ${columnId} on item ${itemId}`);
  return result.change_simple_column_value;
}

/**
 * Get user name from user ID
 */
export async function getUserName(userId) {
  const query = `
    query ($userId: [ID!]) {
      users (ids: $userId) {
        id
        name
      }
    }
  `;

  try {
    const result = await mondayRequest(query, { userId: [userId] });
    return result.users[0]?.name || 'Someone';
  } catch (error) {
    console.error(`[MondayAPI] Error fetching user ${userId}:`, error);
    return 'Someone';
  }
}

// Board IDs for ESS projects
const BOARD_IDS = {
  // ESS_2025: '7059269339',  // Removed - no longer syncing 2025
  ESS_2026: '18392974573'  // 2026 mlb ess (new board as of Dec 2025)
};

// Group name for non-ESS items (routed to OPD channel instead of ESS)
const NON_ESS_GROUP_NAME = 'MLB non-ESS jobs';

/**
 * Check if Monday.com is properly configured
 */
export function isMondayConfigured() {
  return !!MONDAY_API_TOKEN;
}

/**
 * Get board IDs
 */
export function getBoardIds() {
  return BOARD_IDS;
}

/**
 * Get all items from the 2026 board (ESS and non-ESS).
 * Each project is tagged with isNonESS based on its group.
 * @param {object} options - Query options
 * @param {Date} [options.createdSince] - Only get items created after this date
 * @returns {Promise<Array>} List of projects
 */
export async function getESSProjects({ createdSince } = {}) {
  try {
    console.log('[monday] Fetching all projects from 2026 board...');

    // Only sync 2026 board
    const boardIds = [BOARD_IDS.ESS_2026];
    const allProjects = [];

    for (const boardId of boardIds) {
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        // Include group info in the query
        // Monday API requires either query_params OR cursor, not both
        const itemsPageArg = cursor
          ? `items_page(limit: 100, cursor: $cursor)`
          : `items_page(limit: 100, query_params: {rules: [], operator: and})`;
        const query = `query ($boardId: [ID!]${cursor ? ', $cursor: String' : ''}) {
          boards(ids: $boardId) {
            id
            name
            ${itemsPageArg} {
              cursor
              items {
                id
                name
                created_at
                updated_at
                group {
                  id
                  title
                }
                column_values {
                  id
                  text
                  value
                }
              }
            }
          }
        }`;

        const data = await mondayRequest(query, { boardId: [boardId], cursor });

        const board = data.boards[0];
        if (!board) break;

        const items = board.items_page.items || [];

        // Filter by creation date if specified
        let filteredItems = items;
        if (createdSince) {
          filteredItems = items.filter(item => {
            const createdAt = new Date(item.created_at);
            return createdAt > createdSince;
          });
        }

        // Parse and add to results — tag each with its group
        for (const item of filteredItems) {
          const project = parseProjectItem(item, board.name);
          const groupTitle = item.group?.title || '';
          project.isNonESS = groupTitle.toLowerCase().includes('non-ess');
          project.isESS = !project.isNonESS;
          project.groupName = groupTitle;
          allProjects.push(project);
        }

        // Check if there are more pages
        cursor = board.items_page.cursor;
        hasMore = items.length === 100 && cursor;
      }
    }

    const essCount = allProjects.filter(p => p.isESS).length;
    const nonEssCount = allProjects.filter(p => p.isNonESS).length;
    console.log(`[monday] Fetched ${allProjects.length} projects (${essCount} ESS, ${nonEssCount} non-ESS)`);
    return allProjects;
  } catch (error) {
    console.error('[monday] Error fetching ESS projects:', error);
    throw error;
  }
}

/**
 * Parse a Monday.com item into a structured project object
 */
function parseProjectItem(item, boardName) {
  const columns = {};

  // Convert column_values array to object for easier access
  item.column_values.forEach(col => {
    columns[col.id] = {
      text: col.text,
      value: col.value ? JSON.parse(col.value) : null
    };
  });

  // Helper to get column text value
  const getColumn = (id) => columns[id]?.text || '';
  const getColumnValue = (id) => columns[id]?.value;

  // Extract location data
  const locationValue = getColumnValue('location__1') || getColumnValue('location_mktt6fdg');
  const location = locationValue ? {
    address: locationValue.address || '',
    city: locationValue.city || getColumn('text_mkttmrk'),
    state: locationValue.country || getColumn('text_mkttgw6h'),
    lat: locationValue.lat,
    lng: locationValue.lng
  } : null;

  return {
    mondayItemId: item.id,
    boardName,
    name: item.name,
    createdAt: new Date(item.created_at),
    updatedAt: new Date(item.updated_at),

    // Key project fields
    sageNumber: getColumn('text_mkq7x0b9') || getColumn('text_mkttv5t8'),
    location,
    city: getColumn('text_mkttmrk') || location?.city || '',
    state: getColumn('text_mkttgw6h') || location?.state || '',

    // Scope of work
    materialQuantities: getColumn('material_notes__1') || getColumn('long_text_mktt9e5b'),
    materialNotes: getColumn('text9__1') || getColumn('text_mkttyv5v'),
    otherNotes: getColumn('text_mkttbh86'),
    mlbSow: getColumn('long_text_mkz4gkft'),

    // Timeline
    uhcCSD: getColumn('date_1_Mjj5bf4E') || getColumn('date_mkttbkq6'),
    walCSD: getColumn('date_mktt8k9c'),
    endDate: getColumn('date4') || getColumn('date_mkttr3mj'),
    timeline: getColumnValue('timerange_mks352me') || getColumnValue('timerange_mkttmwwb'),

    // Assignment
    superintendent: getColumn('multiple_person_mkw3bmjz') || getColumn('multiple_person_mkx3hxxd'),
    crew: getColumn('color_mks4ccmc') || getColumn('color_mkttktv7'),

    // Status
    status: getColumn('color_mkxend9y') || getColumn('color_mkx3hv3h'),
    startStatus: getColumn('status_mkkbyzrp') || getColumn('color_mktt5dqs'),

    // Communication
    projectEmail: getColumn('text_mkwqrdjx') || getColumn('text_mkx3nt11'),

    // Raw data for reference
    rawColumns: columns
  };
}

/**
 * Get recent updates/comments for a Monday.com item
 * @param {string} itemId - Monday.com item ID
 * @param {number} limit - Max updates to fetch (default 25)
 * @returns {Promise<Array>} List of updates with id, text_body, created_at, creator
 */
/**
 * Get assets (files/images) for a specific Monday.com update
 */
export async function getUpdateAssets(updateId) {
  const query = `
    query ($updateId: [ID!]) {
      updates (ids: $updateId) {
        assets {
          id
          name
          url
          public_url
          file_extension
        }
      }
    }
  `;
  const result = await mondayRequest(query, { updateId: [updateId] });
  return result.updates?.[0]?.assets || [];
}

export async function getItemUpdates(itemId, limit = 25) {
  const query = `
    query ($itemId: [ID!], $limit: Int!) {
      items (ids: $itemId) {
        updates (limit: $limit) {
          id
          text_body
          created_at
          creator {
            id
            name
          }
          assets {
            id
            name
            url
            public_url
            file_extension
          }
          replies {
            id
            text_body
            created_at
            creator {
              id
              name
            }
          }
        }
      }
    }
  `;

  const result = await mondayRequest(query, { itemId: [itemId], limit });
  const updates = result.items[0]?.updates || [];

  // Flatten: return both top-level updates and replies as a single list
  const all = [];
  for (const u of updates) {
    all.push(u);
    if (u.replies) {
      for (const r of u.replies) {
        r.isReply = true;
        r.parentId = u.id;
        all.push(r);
      }
    }
  }
  return all;
}

/**
 * Get item details (to find board ID and column IDs)
 */
export async function getItem(itemId) {
  const query = `
    query ($itemId: [ID!]) {
      items (ids: $itemId) {
        id
        name
        group {
          id
          title
        }
        board {
          id
          name
          columns {
            id
            title
          }
        }
        column_values {
          id
          type
          text
          value
          ... on MirrorValue {
            display_value
          }
        }
      }
    }
  `;

  const result = await mondayRequest(query, { itemId: [itemId] });

  // Map column IDs to titles using board column definitions
  if (result.items[0]) {
    const columnTitles = {};
    result.items[0].board.columns.forEach(col => {
      columnTitles[col.id] = col.title;
    });

    result.items[0].column_values = result.items[0].column_values.map(col => ({
      ...col,
      title: columnTitles[col.id] || col.id,
      // Mirror columns return data in display_value instead of text
      text: col.text || col.display_value || ''
    }));
  }

  return result.items[0];
}
