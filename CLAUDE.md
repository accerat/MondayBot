# MondayBot - Claude Notes

## Shared Bot Resources (ALL BOTS USE THESE)
- **Bot Data Storage:** https://drive.google.com/drive/folders/19-YavW7le0FlEaBd24OJ2LdeuD4srUAj
  - All JSON data files for all bots
- **Bot Information:** https://drive.google.com/drive/folders/1hV9U3vtrzxu3RNN5lFfvRBHUX6C7bBA3
  - bot-capabilities.md - shared documentation of all bot features

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
| AWS IP | 3.148.164.166 (changes on reboot - use AWS CLI to get current) |
| PM2 Process | MondayBot |
| Webhook Port | 3001 |
| Webhook URL | http://3.148.164.166:3001/webhook/monday |

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

| Board | ID |
|-------|-----|
| ESS 2025 | 7059269339 |
| MLB 2026 ESS | 18392974573 |

---

## Features

### Core Features
- **Webhook receiver** - Receives Monday.com webhooks and posts updates to Discord threads
- **Thread creation** - Auto-creates Discord threads for new Monday items
- **Branch routing** - Routes to ESS or OPD channel based on Branch column value
- **@mention handler** - Responds to @MondayBot mentions in Discord

### Scheduled Jobs
| Job | Schedule | Description |
|-----|----------|-------------|
| Daily Sync | 7 AM CT daily | Auto-creates threads for items missing them, posts report |
| Weekly Summary | 8 AM CT Mondays | Posts weekly stats (threads created, flags, resolutions) |
| Health Monitor | Every 5 min | Checks Monday API + Discord, alerts after 3 failures |

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

---

## Key Files

### Entry Point
- `src/index.js` - Main entry (Discord client + Express webhook server)

### Services
- `src/services/mondayWebhook.js` - Handles incoming Monday.com webhooks
- `src/services/mondayApi.js` - Monday.com API client
- `src/services/threadMapper.js` - Maps Monday item IDs to Discord thread IDs
- `src/services/flagTracker.js` - Tracks flagged items (prevents duplicates)
- `src/services/healthMonitor.js` - Health check system
- `src/services/mondayMentionHandler.js` - Handles @MondayBot mentions
- `src/services/projectSyncOrchestrator.js` - Orchestrates project syncing

### Jobs
- `src/jobs/dailySync.js` - Daily auto-sync (7 AM CT)
- `src/jobs/weeklySummary.js` - Weekly summary (Monday 8 AM CT)

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
http://3.148.164.166:3001/webhook/monday
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

## Item Filtering (Mason/Carp Status)

The bot only syncs items that have a **Mason/Carp Status** value (e.g., "MLB", "MLB Survey", "MLB pending").

Items with empty Mason/Carp Status are excluded - these are typically internal/template items like "Dura surveys", "Paint codes", etc.

The filter:
- Auto-detects the column ID by searching for "mason" or "carp" in column titles
- Caches column IDs to reduce API calls
- Can be bypassed with `includeAll: true` option if needed

---

## Branch Routing Logic

| Branch Value | Action |
|--------------|--------|
| ESS | Create thread in ESS channel |
| OPD | Create thread in OPD channel |
| (empty) | Flag: "No branch selected" |
| Multiple values | Flag: "Multiple branches selected" |
| Other value | Flag: "Unrecognized branch: X" |

When a flagged item's branch is fixed, the bot:
1. Creates the thread
2. Posts "Resolved" notice to flag channel
3. Removes item from flag tracking

---

## Deployment

### Standard Deployment (via Git)
```bash
# Local: commit and push
cd C:/Users/blitz/bots/MondayBot
git add -A && git commit -m "Description" && git push origin main

# AWS: pull and restart
ssh -i "C:/Users/blitz/bots/LightsailDefaultKey-us-east-2-new.pem" admin@3.148.164.166 \
  "cd /home/admin/bots/MondayBot && git pull && npm install && npm run register && pm2 restart MondayBot --update-env"
```

### Check Logs
```bash
ssh -i "C:/Users/blitz/bots/LightsailDefaultKey-us-east-2-new.pem" admin@3.148.164.166 \
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
```

---

## Troubleshooting

### Webhook not receiving events
- Check Monday.com automation is active (green)
- Verify AWS IP hasn't changed
- Check bot logs for incoming webhook messages

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

### 2026-02-11: Mason/Carp Status Filter
- Added filter to only sync items with Mason/Carp Status value
- Excludes internal/template items (empty status like "Dura surveys", "Paint codes")
- Auto-detects column ID, caches for performance

### 2026-02-10: Added 6 New Features
1. **Flag Resolution Notice** - Posts "Resolved" when flagged items are fixed
2. **Duplicate Flag Prevention** - Tracks flagged items, prevents spam
3. **Weekly Summary** - Posts stats every Monday 8 AM CT
4. **Auto-Archive** - Archives threads when status is Complete/Done
5. **Daily Sync** - Auto-creates missing threads daily at 7 AM CT
6. **Health Alerts** - Monitors API health, alerts after 3 failures

**TODO:** Configure Monday.com webhooks (user will do this later)
