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
- Creates Discord threads when Monday.com items are created/updated
- Routes by group: non-ESS → Default channel, ESS → ESS channel, OPD branch → OPD channel
- Pinned project info posts in each thread (CTL, electrician, dates, materials, SOW)
- Comment notifications: Monday comments ping foreman + ops leadership in Discord
- "Reply to Monday.com" button on comments → modal → forwards reply
- Reply-to-forward: reply to any message + @MondayBot to forward it to Monday.com
- @mention handler: \`@MondayBot update/status/attach/help\`
- Cross-bot API for DailyReportBot (forward reports + photos to Monday.com)
- Photo uploads convert to JPEG via sharp before uploading to Monday.com
- Nightly comment reconciler catches missed webhooks + nested replies
- Nightly pinned post refresh keeps project info current
- Cycle prevention: Discord→Monday posts are not echoed back

### Discord Channels
| Channel | ID | Purpose |
|---------|-----|---------|
| ESS Channel | 1456320404330381425 | ESS projects (all groups except non-ESS) |
| OPD Channel | 1446176868695937084 | OPD branch projects |
| Default Channel | 1397270791175012453 | Non-ESS group projects |
| Flag Channel | 1397271405606998036 | Flagged items |

### Monday.com Boards
- MLB 2026 ESS: 18392974573 (only active board)

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| \`POST /webhook/monday\` | POST | Receives Monday.com webhooks |
| \`POST /api/forward-to-monday\` | POST | Cross-bot: post text to Monday item |
| \`POST /api/forward-photos-to-monday\` | POST | Cross-bot: upload photos (JPEG) to Monday item |
| \`GET /api/lookup-monday-id/:threadId\` | GET | Resolve Discord thread → Monday item ID |
| \`GET /api/project-dates/:threadId\` | GET | Get project timeline/dates for a thread |
| \`POST /scheduler/*\` | POST | Central scheduler job triggers |

### Scheduled Jobs (via Central Scheduler)
| Job | Schedule | Function |
|-----|----------|----------|
| Daily Sync | 7:00 AM CT | Create missing threads |
| Weekly Summary | Mon 8:00 AM CT | Post weekly stats |
| Comment Reconciler | 12:15 AM CT | Catch missed webhooks + replies |
| Pinned Post Refresh | 12:30 AM CT | Update all pinned posts |
| Health Monitor | Every 5 min | Check API + Discord health |

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
