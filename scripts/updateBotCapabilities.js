#!/usr/bin/env node
/**
 * Update bot-capabilities.md in the shared Bot Information folder
 */

import 'dotenv/config';
import { google } from 'googleapis';

const BOT_INFO_FOLDER_ID = '1hV9U3vtrzxu3RNN5lFfvRBHUX6C7bBA3';
const CAPABILITIES_FILE_NAME = 'bot-capabilities.md';

const MONDAYBOT_SECTION = `
## MondayBot

**Purpose:** Bidirectional sync between Monday.com and Discord

**Discord Server:** MLB (Major League Build)
**Webhook Port:** 3001

### Features
- Creates Discord threads when Monday.com items are created
- Updates Discord when Monday.com items change
- Routes projects to appropriate channels based on branch (ESS, OPD)
- @mention handler for project queries
- Weekly project summary reports
- Health monitoring

### Discord Channels
| Channel | ID | Purpose |
|---------|-----|---------|
| ESS Channel | 1456320404330381425 | ESS projects |
| OPD Channel | 1446176868695937084 | OPD projects |
| Default Channel | 1397270791175012453 | Other projects |
| Flag Channel | 1397271405606998036 | Flagged items |

### Monday.com Boards
- ESS 2025: 7059269339
- ESS 2026: 18392974573

### Webhook Endpoint
\`POST /webhook/monday\` - Receives Monday.com change notifications

### Scheduled Jobs
| Job | Schedule | Function |
|-----|----------|----------|
| Weekly Summary | Weekly | Generate project status summary |
| Health Monitor | Continuous | Monitor bot health |

---
`;

async function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return auth;
}

async function main() {
  console.log('Updating bot-capabilities.md with MondayBot info...\n');

  try {
    const auth = await getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Find existing file
    const listRes = await drive.files.list({
      q: `name = '${CAPABILITIES_FILE_NAME}' and '${BOT_INFO_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name)'
    });

    const existingFile = listRes.data.files?.[0];

    if (!existingFile) {
      console.log('bot-capabilities.md not found. Run clockbot updateBotCapabilities first.');
      process.exit(1);
    }

    console.log(`Found file: ${existingFile.id}`);

    // Read current content
    const getRes = await drive.files.get({
      fileId: existingFile.id,
      alt: 'media'
    }, { responseType: 'text' });

    let content = getRes.data;

    // Update MondayBot section
    const sectionRegex = /## MondayBot[\s\S]*?(?=\n## |$)/g;
    if (sectionRegex.test(content)) {
      content = content.replace(sectionRegex, MONDAYBOT_SECTION.trim() + '\n');
    } else {
      content = content.trim() + '\n\n' + MONDAYBOT_SECTION.trim() + '\n';
    }

    // Update file
    await drive.files.update({
      fileId: existingFile.id,
      media: {
        mimeType: 'text/markdown',
        body: content
      }
    });

    console.log('Updated bot-capabilities.md with MondayBot section');
    console.log(`View at: https://drive.google.com/file/d/${existingFile.id}/view`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
