# MondayBot - Claude Notes

## Shared Bot Resources (ALL BOTS USE THESE)
- **Bot Data Storage:** https://drive.google.com/drive/folders/19-YavW7le0FlEaBd24OJ2LdeuD4srUAj
  - All JSON data files for all bots
- **Bot Information:** https://drive.google.com/drive/folders/1hV9U3vtrzxu3RNN5lFfvRBHUX6C7bBA3
  - bot-capabilities.md - shared documentation of all bot features
- **AIBot Knowledge Base:** SQLite database with company Q&A, training materials, and Google Drive docs
  - Location: AIBot's `data/aibot.db`
  - Syncs from Google Drive: Worker Resources folder, Skill Training folder
  - See AIBot's CLAUDE.md for full schema and API details

## Development Rules (ALL BOTS)

- **Always update documentation with feature changes:**
  1. This bot's `CLAUDE.md` — update with new features, code locations, env vars
  2. `scripts/updateBotCapabilities.js` — update the bot's section constant
  3. Project memory (`MEMORY.md`) — update if applicable
- All bots share: AWS `18.118.203.113`, SSH user `admin`, key `LightsailDefaultKey-us-east-2-new.pem`, timezone `America/Chicago`, Guild `1396930021817581732`
- Google Drive is the primary database for all bots (via `driveStorage.js`)

---

## What It Does

Bidirectional sync between Monday.com and Discord:
- Creates Discord threads when Monday.com items are created
- Updates Discord when Monday.com items change (status, columns, comments)
- Routes projects to ESS or OPD channels based on Branch column
- Flags items with invalid/missing branch values
- Auto-archives threads when projects are marked Complete/Done

---

## Infrastructure

| Item | Value |
|------|-------|
| Local Path | C:\Users\blitz\bots\MondayBot |
| AWS Directory | /home/admin/bots/MondayBot |
| AWS IP | 18.118.203.113 (changes on reboot - use AWS CLI to get current) |
| PM2 Process | MondayBot |
| Webhook Port | 3001 |
| Webhook URL | http://18.118.203.113:3001/webhook/monday |

---

## Discord IDs

| Item | ID |
|------|-------|
| Guild ID | 1396930021817581732 |
| ESS Channel | 1456320404330381425 |
| OPD Channel | 1446176868695937084 |
| Default Channel | 1397270791175012453 |
| Flag Channel | 1397271405606998036 |

---

## Monday.com Boards

| Board | ID | Status |
|-------|-----|--------|
| ESS 2025 | 7059269339 | Not synced (removed) |
| MLB 2026 ESS | 18392974573 | Active |

---

## Features

### Core Features
- **Webhook receiver** - Receives Monday.com webhooks and posts updates to Discord threads
- **Thread creation** - Auto-creates Discord threads for new Monday items
- **Group-based routing** - Non-ESS group → Default channel, all other groups → ESS channel, Branch column "OPD" → OPD channel
- **@mention handler** - Responds to @MondayBot mentions in Discord (updates, status changes, file uploads)
- **Reply-to-forward** - Reply to any message + @MondayBot to forward it to the linked Monday.com item
- **Comment notifications** - Monday comments ping the job's foreman (via Crew→Discord mapping) + ops leadership
- **Reply button** - "Reply to Monday.com" button on every comment → modal → forwards reply as Monday update
- **Crew mapping** - Shared Google Drive mapping (crew name → Discord user ID), loaded on startup
- **Pinned posts** - Rich project info pinned in each thread (CTL, electrician, dates, materials, etc.)
- **Cycle prevention** - Discord→Monday posts are detected and not echoed back to Discord

### Cross-Bot API (port 3001)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/forward-to-monday` | POST | Posts text update to Monday.com item (used by DailyReportBot) |
| `/api/forward-photos-to-monday` | POST | Uploads photos as JPEG to Monday.com update (downloads, converts via sharp) |
| `/api/lookup-monday-id/:threadId` | GET | Resolves Discord thread → Monday item ID |
| `/api/project-dates/:threadId` | GET | Returns project timeline/dates (used by LodgingBot) |

### Scheduled Jobs (via Central Scheduler)
| Job | Schedule | Description |
|-----|----------|-------------|
| Daily Sync | 7 AM CT daily | Auto-creates threads for items missing them, posts report |
| Weekly Summary | 8 AM CT Mondays | Posts weekly stats (threads created, flags, resolutions) |
| Comment Reconciler | Every 15 min | Catches missed webhooks + replies (30-min lookback) |
| Pinned Post Refresh | 12:30 AM CT daily | Updates all pinned posts with latest Monday.com data (edit only, no new posts) |
| Health Monitor | Every 5 min | Checks Monday API + Discord, alerts after 3 failures |

All scheduled jobs also have `/scheduler/*` HTTP endpoints for the central scheduler service. Set `SCHEDULER_MODE=external` to disable local cron.

### Flag System
- **Flag on invalid branch** - Posts to flag channel if branch is empty, multiple, or unrecognized
- **Duplicate prevention** - Tracks flagged items to prevent spam (same item/reason won't re-flag)
- **Resolution notices** - Posts "Resolved" to flag channel when branch is fixed and thread created

### Auto-Archive
- When status changes to "Complete" or "Done", thread is archived automatically

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/monday-sync-projects` | Manually sync Monday items to Discord (with board selection) |
| `/monday-backfill` | Find items missing threads (manual override for daily sync) |
| `/monday-status` | Check bot status |
| `/project-info` | Get info about a specific project |
| `/monday-refresh-posts` | Bulk-update all pinned posts with latest Monday.com data (creates missing ones) |

---

## Key Files

### Entry Point
- `src/index.js` - Main entry (Discord client + Express webhook server)

### Services
- `src/services/mondayWebhook.js` - Handles incoming Monday.com webhooks (comment notifications, reply button, value extraction)
- `src/services/mondayApi.js` - Monday.com API client
- `src/services/threadMapper.js` - Maps Monday item IDs to Discord thread IDs
- `src/services/pinnedPostFormatter.js` - Formats/updates pinned posts with project info (CTL, electrician, etc.)
- `src/services/crewMapping.js` - Crew name → Discord user ID mapping (shared Google Drive file)
- `src/services/flagTracker.js` - Tracks flagged items (prevents duplicates)
- `src/services/healthMonitor.js` - Health check system
- `src/services/mondayMentionHandler.js` - Handles @MondayBot mentions
- `src/services/projectSyncOrchestrator.js` - Orchestrates project syncing

### Utils
- `src/utils/driveStorage.js` - Google Drive storage wrapper for crew mapping

### HTTP Routes
- `src/http/schedulerRoutes.js` - Central scheduler endpoints (`/scheduler/*`)
- `src/http/apiRoutes.js` - Cross-bot API endpoints (`/api/*`) — forward-to-monday, photo upload, project dates

### Jobs
- `src/jobs/dailySync.js` - Daily auto-sync (7 AM CT)
- `src/jobs/weeklySummary.js` - Weekly summary (Monday 8 AM CT)
- `src/jobs/commentReconciler.js` - Nightly comment + reply reconciliation (catches missed webhooks)

### Commands
- `src/commands/mondaySyncProjects.js` - Manual sync command
- `src/commands/mondayBackfill.js` - Backfill command
- `src/commands/mondayStatus.js` - Status command
- `src/commands/projectInfo.js` - Project info command

### Data Files (auto-created in /data/)
- `thread-mapping.json` - Monday item ID → Discord thread ID mappings
- `flagged-items.json` - Currently flagged items (for duplicate prevention)
- `weekly-stats.json` - Weekly stat counters

---

## Monday.com Webhook Setup (TODO)

Webhooks need to be configured in Monday.com to send to the bot.

### Webhook URL
```
http://18.118.203.113:3001/webhook/monday
```

### Required Automations (per board)
1. **When item is created** → Send webhook
2. **When column changes** → Send webhook
3. **When status changes** → Send webhook
4. **When update is posted** → Send webhook

### Setup Steps
1. Go to Monday.com board → Automations → + Add Automation
2. Search for "webhook"
3. Configure trigger → Set URL → Save
4. Repeat for both boards (2025 ESS and MLB 2026 ESS)

---

## Item Routing (Group + Branch Based)

ALL items on the 2026 board are synced. Routing is determined by group first, then Branch column:

| Condition | Discord Channel |
|-----------|----------------|
| "MLB non-ESS jobs" group | Default channel (1397270791175012453) |
| Branch column = "OPD" | OPD channel (1446176868695937084) |
| Everything else | ESS channel (1456320404330381425) |

New groups (e.g. "November 2026") are automatically treated as ESS.

**Note:** Only the 2026 board is synced. 2025 board was removed.

---

## Deployment

### Standard Deployment (via Git)
```bash
# Local: commit and push
cd C:/Users/blitz/bots/MondayBot
git add -A && git commit -m "Description" && git push origin main

# AWS: pull and restart
ssh -i "C:/Users/blitz/bots/LightsailDefaultKey-us-east-2-new.pem" admin@18.118.203.113 \
  "cd /home/admin/bots/MondayBot && git pull && npm install && npm run register && pm2 restart MondayBot --update-env"
```

### Check Logs
```bash
ssh -i "C:/Users/blitz/bots/LightsailDefaultKey-us-east-2-new.pem" admin@18.118.203.113 \
  "pm2 logs MondayBot --lines 30 --nostream"
```

### Get Current AWS IP (if changed)
```bash
"C:\Program Files\Amazon\AWSCLIV2\aws.exe" lightsail get-instances --region us-east-2 --query "instances[0].publicIpAddress" --output text
```

---

## Environment Variables

Required in `.env`:
```
BOT_TOKEN=<Discord bot token>
MONDAY_API_TOKEN=<Monday.com API token>
GUILD_ID=1396930021817581732
ESS_CHANNEL_ID=1456320404330381425
OPD_CHANNEL_ID=1446176868695937084
DEFAULT_CHANNEL_ID=1397270791175012453
FLAG_CHANNEL_ID=1397271405606998036
WEBHOOK_PORT=3001
TIMEZONE=America/Chicago
CREW_MAPPING_DRIVE_ID=<Google Drive file ID for shared crew mapping>
GOOGLE_OAUTH_CLIENT_ID=<Google OAuth client ID>
GOOGLE_OAUTH_CLIENT_SECRET=<Google OAuth client secret>
GOOGLE_OAUTH_REFRESH_TOKEN=<Google OAuth refresh token>
SCHEDULER_TOKEN=<shared token for central scheduler + cross-bot auth>
SCHEDULER_MODE=<set to "external" to disable local cron, let central scheduler handle jobs>
```

---

## Troubleshooting

### Webhook not receiving events
- **Check port 3001 is open** in Lightsail firewall (has been closed before, blocking all webhooks)
- Check Monday.com automation is active (green) and shows activity, not "in progress" stuck
- Verify AWS IP hasn't changed
- Check bot logs for incoming webhook messages
- Test externally: `curl -X POST http://18.118.203.113:3001/webhook/monday -H "Content-Type: application/json" -d '{"challenge":"test"}'`

### Thread not created
- Check Branch column value (must be exactly "ESS" or "OPD")
- Look in flag channel for flagged items
- Check logs for errors

### Health alerts firing
- Check Monday.com API token is valid
- Verify Discord bot token is valid
- Check AWS instance is running

---

## Session Notes

### 2026-04-22: Scheduler Fix, Cycle Prevention, Foreman Verification, Processing Feedback
- **Scheduler .env was missing** — All scheduled jobs across all bots were failing 401 since SCHEDULER_MODE=external was enabled. Created `.env` on server. Also fixed ESM import ordering: token read at request time via `getToken()` instead of module-level constant.
- **Cycle prevention improved** — Reconciler now skips updates containing `from Discord` or starting with `Daily Report —`. Photos from Monday.com (native) still forward to Discord. Uses full text match instead of truncated fingerprint for duplicate detection.
- **Foreman verification fix** — Was tagging whoever last submitted a daily report instead of the actual assigned foreman. Now uses Monday.com crew mapping (shared Google Drive) to resolve correct foreman from `crew_monday` field.
- **Processing feedback** — All buttons now show immediate visual feedback ("⏳ Sending to Monday...", "⏳ Thinking...") instead of silent defer. Applied to MondayBot, DailyReportBot, and AIBot.
- **Foreman "No" flow** — Opens modal asking when they'll be on site + reason. Escalates to Ops Leadership + MLB Office in thread and #urgent-schedule-changes. "Yes" only notifies MLB Office in thread. Removed automatic Monday.com forwarding.
- **Surveyor role** (1473765347005042761) added to Send to Monday button permissions.

### 2026-04-13: File Forwarding, Port Fix, Reconciler Frequency, @MondayBot Panel
- **Port 3001 was closed** in Lightsail firewall — ALL Monday.com webhooks were blocked. Opened port 3001 (and 3002-3007 for other bots).
- **File column forwarding** — When files are uploaded to Monday.com file columns (Building Permit, etc.), the bot downloads them via `public_url` (S3) and posts as Discord attachments. `protected_static` URLs don't work (require browser auth).
- **Image forwarding on comments** — Monday.com comment images (assets) are downloaded and posted as Discord attachments alongside the comment text. Uses `getUpdateAssets()` with `public_url`.
- **Existing files on thread creation** — When a new thread is created and the item already has files, they're downloaded and posted immediately.
- **Comment reconciler now runs every 15 minutes** (was midnight only) to catch replies faster. Lookback window reduced to 30 minutes.
- **Fixed reconciler crash** — `assets` field on `Reply` type is not supported by Monday API. Removed from query.
- **@MondayBot action panel** — Tagging @MondayBot with no text shows buttons: Send Photos to Monday, Forward Recent Messages, Write Update to Monday. Photo selector shows 5 per page as thumbnails with toggle buttons and dates.
- **Photo upload actually works** — Fixed multipart form (use `form-data` package + `/v2/file` endpoint + `form.submit()`). Photos converted to JPEG via sharp, uploaded 3 at a time in parallel. Progress message posted to thread (not ephemeral).
- **SCHEDULER_MODE=external** enabled on all bots — local crons disabled, central scheduler is sole source of truth.
- **Webhook automation** — New "When Building Permit changes" webhook configured on Monday.com board.

### 2026-04-04: Central Scheduler, Cross-Bot API, Sync Fixes, Reply Forwarding
- **Central Scheduler** — New service orchestrates all 28 cron jobs across 8 bots sequentially via HTTP. MondayBot jobs: daily-sync, weekly-summary, comment-reconciler, refresh-pinned-posts. Set `SCHEDULER_MODE=external` to disable local cron.
- **Comment Reconciler** — Nightly job catches missed webhooks. Now also catches Monday.com **replies** (which don't trigger webhooks).
- **Pinned Post Refresh** — Nightly update of all pinned posts. Fixed fundamental bug: forum thread starter message ID equals thread ID in Discord, so `messages.fetch()` always failed. Now uses `fetchStarterMessage()` directly.
- **Cross-Bot API** — `POST /api/forward-to-monday` (text updates), `POST /api/forward-photos-to-monday` (downloads + converts to JPEG via sharp + uploads as files), `GET /api/lookup-monday-id/:threadId`, `GET /api/project-dates/:threadId` (used by LodgingBot).
- **Non-ESS sync** — Removed group exclusion filter. Non-ESS items now sync to Default channel. ESS items sync to ESS channel. Branch column OPD override still works.
- **Reply-to-forward** — Reply to any message in a project thread + @MondayBot to forward it to Monday.com. Includes original author, content, embeds, and optional note.
- **Cycle prevention** — Webhook handler skips updates containing `(Discord):` or `Photos from Discord` to prevent Discord→Monday→Discord loops.
- **Nickname fix** — All Discord→Monday posts use server nickname (member.displayName) instead of global username.
- New files: `src/http/schedulerRoutes.js`, `src/http/apiRoutes.js`, `src/jobs/commentReconciler.js`
- New dependency: `sharp` (image conversion for photo uploads)

### 2026-03-19: Comment Notifications + Reply Button + Electrician Fix
- Fixed webhook value extraction for all column types (dropdowns, mirrors, dates, etc.)
- Fixed pinned post using stale data — now re-fetches from API on updates
- Added foreman + ops leadership pings on Monday comments (crew mapping from Google Drive)
- Added "Reply to Monday.com" button on comments (modal → forwards to Monday as update)
- Warns ops when crew-to-Discord link is missing
- Ops leadership ID: 1411793485799096490

### 2026-02-19: Group-Based Filtering
- Changed from Mason/Carp Status to group-based filtering
- Excludes items in "MLB non-ESS jobs" group
- All other items default to ESS channel
- Removed 2025 board from syncing (only 2026 now)
- Daily sync no longer flags items - just creates ESS threads

### 2026-02-10: Added 6 New Features
1. **Flag Resolution Notice** - Posts "Resolved" when flagged items are fixed
2. **Duplicate Flag Prevention** - Tracks flagged items, prevents spam
3. **Weekly Summary** - Posts stats every Monday 8 AM CT
4. **Auto-Archive** - Archives threads when status is Complete/Done
5. **Daily Sync** - Auto-creates missing threads daily at 7 AM CT
6. **Health Alerts** - Monitors API health, alerts after 3 failures

**TODO:** Configure Monday.com webhooks (user will do this later)
