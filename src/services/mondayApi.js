// src/services/mondayApi.js
// Monday.com API client for sending updates from Discord

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
 * Upload a file to a Monday.com item
 */
export async function uploadFile(itemId, fileUrl, fileName) {
  const query = `
    mutation ($itemId: ID!, $fileUrl: String!) {
      add_file_to_update (item_id: $itemId, url: $fileUrl) {
        id
      }
    }
  `;

  const result = await mondayRequest(query, {
    itemId: itemId,
    fileUrl: fileUrl
  });

  console.log(`[MondayAPI] Uploaded file "${fileName}" to item ${itemId}`);
  return result.add_file_to_update;
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
 * Get item details (to find board ID and column IDs)
 */
export async function getItem(itemId) {
  const query = `
    query ($itemId: [ID!]) {
      items (ids: $itemId) {
        id
        name
        board {
          id
          name
        }
        column_values {
          id
          title
          text
          value
        }
      }
    }
  `;

  const result = await mondayRequest(query, { itemId: [itemId] });
  return result.items[0];
}
