# MondayBot Status Notes

**Last Updated:** 2026-02-09

---

## CURRENT STATUS: Updated - Needs Deploy

Changes made locally, needs deployment to AWS.

---

## Features Implemented

### 1. Branch-Based Channel Routing (UPDATED 2026-02-09)
Routes Discord thread creation based on the "Branch" dropdown column in Monday.com:
- **ESS** → Channel `1456320404330381425` (mlb-2026-ess)
- **OPD** → Channel `1446176868695937084` (2026-opd-program)
- **Empty/Other/Unrecognized** → **FLAGGED** to Channel `1397271405606998036` (no thread created)
- **Multiple branches selected** → **FLAGGED** to Channel `1397271405606998036` (no thread created)

**Flag Message Format:**
```
⚠️ **Branch Issue** - Item "Store Name" (ID: `12345`)
**Reason:** No branch selected / Multiple branches selected / Unrecognized branch: "xyz"
**Current Branch Value:** (empty) or ESS, OPD
Please set a valid branch (ESS or OPD) in Monday.com. The Discord thread will be created automatically once fixed.
```

**Important:** The Branch column ID is `dropdown_mm07kqx` on the MLB 2026 ESS board.

### 2. Automatic Sync - ALL Items (UPDATED 2026-02-09)
**Removed filtering** - ALL Monday.com items now sync to Discord automatically.
- Previously: Only synced if "Mason/Carp" contained "team mlb" OR "Survey Assignment" contained "nick phelps"
- Now: Syncs all items (branch routing determines where/if thread is created)

### 3. Branch Correction Auto-Creates Thread (NEW 2026-02-09)
When a flagged item has its Branch column updated to a valid value (ESS or OPD):
- The webhook detects the branch column change
- Checks if thread exists (it won't for previously flagged items)
- Automatically creates the thread in the correct channel
- No manual sync needed!

### 4. Auto-Update on Column Changes (WORKING)
When columns are updated in Monday.com, Discord thread is updated automatically:
- WAL Start/End dates
- Location
- Contacts
- Materials
- Survey Assignment
- And all other configured columns

### 5. Slash Commands (WORKING)
All Monday.com commands are on MondayBot (moved from TaskBot):
- `/monday-sync-projects` - Manually sync Monday.com projects to Discord
- `/monday-status` - Check bot status and thread mappings
- `/project-info` - Display project details (use in a project thread)

### 3. Sync Detection (WORKING)
The sync command correctly:
- Checks thread-mapping.json for already-mapped projects
- Searches Discord forums for existing threads by name
- Only shows/syncs projects that genuinely need threads
- Logs branch detection: `[sync] Branch for "Project Name": "ESS"`

### 4. Webhook Routing (WORKING)
Incoming Monday.com webhooks also route based on branch column.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/commands/mondaySyncProjects.js` | /monday-sync-projects command |
| `src/services/projectSyncOrchestrator.js` | Sync logic, branch detection |
| `src/services/mondayWebhook.js` | Webhook handling, branch routing |
| `src/services/mondayApi.js` | Monday.com API client |
| `src/services/threadMapper.js` | Thread ID mapping |
| `data/thread-mapping.json` | Monday item ID ↔ Discord thread ID |
| `data/project-sync-state.json` | Sync state tracking |

---

## Environment Variables (AWS)

```env
# Discord
BOT_TOKEN=...
APP_ID=1451325736232292426
GUILD_ID=1396930021817581732

# Monday.com
MONDAY_API_TOKEN=...
WEBHOOK_PORT=3001

# Branch-based channel routing
ESS_CHANNEL_ID=1456320404330381425
OPD_CHANNEL_ID=1446176868695937084
DEFAULT_CHANNEL_ID=1397270791175012453
FLAG_CHANNEL_ID=1397271405606998036

# Legacy (fallback)
PROJECTS_CATEGORY_ID=1396930022941397079
```

---

## Deployment

**ALL BOTS RUN ON AWS, NOT LOCALLY.**

```bash
# 1. Edit locally, commit, push
cd C:/Users/blitz/bots/MondayBot
git add -A && git commit -m "message" && git push origin main

# 2. Get current AWS IP (changes on reboot)
"C:\Program Files\Amazon\AWSCLIV2\aws.exe" lightsail get-instances --region us-east-2 --query "instances[0].publicIpAddress" --output text

# 3. Deploy to AWS
ssh -i C:/Users/blitz/bots/LightsailDefaultKey-us-east-2-new.pem admin@[IP] "cd /home/admin/bots/MondayBot && git pull origin main && pm2 restart MondayBot --update-env"

# 4. Check logs
ssh -i C:/Users/blitz/bots/LightsailDefaultKey-us-east-2-new.pem admin@[IP] "pm2 logs MondayBot --lines 50"
```

---

## Troubleshooting

### "Already synced" but thread doesn't exist
The thread was deleted but still in mapping. Fix:
```bash
# SSH to AWS and remove entries from mapping
ssh admin@[IP] "cd /home/admin/bots/MondayBot && node -e \"
const fs = require('fs');
const mapping = JSON.parse(fs.readFileSync('./data/thread-mapping.json', 'utf8'));
delete mapping.mappings['ITEM_ID_HERE'];
fs.writeFileSync('./data/thread-mapping.json', JSON.stringify(mapping, null, 2));
\""
```

### Projects going to wrong channel
Check if the Branch column has the correct value in Monday.com. The bot looks for column ID `dropdown_mm07kqx`.

### Permission errors
Ensure MondayBot has `Send Messages` and `Create Public Threads` in the target forum channel.

---

## Session History (2026-02-08)

1. Added branch-based channel routing (ESS/OPD/Other)
2. Moved `/monday-sync-projects` from TaskBot to MondayBot
3. Fixed sync to check existing Discord threads by name
4. Fixed branch column detection (column ID `dropdown_mm07kqx`)
5. Fixed permission issue on non-walmart-project-reports channel
6. All 4 test projects synced correctly to proper channels

## Session History (2026-02-09)

1. **Changed Empty/Other branch handling** - Now flags instead of creating in default channel
2. **Removed sync filtering** - All items now sync (no Mason/Carp or Nick Phelps filter)
3. **Added branch correction handling** - When flagged item's branch is fixed, thread auto-creates
4. **Confirmed auto-updates working** - Column changes in Monday.com auto-post to Discord threads
