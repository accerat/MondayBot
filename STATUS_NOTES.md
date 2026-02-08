# MondayBot Status Notes

**Last Updated:** 2026-02-07

---

## CURRENT STATUS: Mostly Working, One Permission Issue

MondayBot is deployed and running on AWS. The branch routing and sync features are implemented and working correctly.

---

## What Was Done This Session

### 1. Branch-Based Channel Routing (COMPLETE)
Added routing based on the "Branch" dropdown column in Monday.com:
- **ESS** → Channel `1456320404330381425`
- **OPD** → Channel `1446176868695937084`
- **Other/Empty** → Channel `1397270791175012453` (non-walmart-project-reports)
- **Multiple branches selected** → Flags to `1397271405606998036` instead of creating thread

### 2. Moved /monday-sync-projects from TaskBot (COMPLETE)
- Command now lives in MondayBot, removed from TaskBot
- TaskBot no longer has any Monday.com functionality
- All Monday.com related code is now in MondayBot

### 3. Fixed Sync to Check Existing Threads (COMPLETE)
- Command now checks Discord for existing threads by name (not just mapping file)
- Checks both active AND archived threads
- Correctly identifies 74+ existing threads and skips them
- Only shows projects that genuinely need syncing

---

## PENDING ISSUE: Permission Error on non-walmart-project-reports

**Problem:** 4 projects failed to sync with "Missing Access" error:
- 1203.1008 Wimauma, FL
- 2853.1003 La Plata, MD
- Marine Layer - Austin
- Edikted - Houston

**Root Cause:** MondayBot lacks permissions in channel `1397270791175012453` (non-walmart-project-reports)

**Verified Permissions:**
```
Channel: non-walmart-project-reports
Bot: MondayBot#1546
  ViewChannel: true
  SendMessages: false        <-- MISSING
  SendMessagesInThreads: true
  CreatePublicThreads: false <-- MISSING
  ManageThreads: false
```

**Fix Required:** In Discord, edit the `non-walmart-project-reports` channel:
1. Go to channel settings → Permissions
2. Add MondayBot or ensure botperms role has:
   - Send Messages ✓
   - Create Public Threads ✓

These 4 projects are going to the DEFAULT channel because they either have no Branch set or a Branch value that's not "ESS" or "OPD".

---

## Environment Variables on AWS

Located at `/home/admin/bots/MondayBot/.env`:
```
ESS_CHANNEL_ID=1456320404330381425
OPD_CHANNEL_ID=1446176868695937084
DEFAULT_CHANNEL_ID=1397270791175012453
FLAG_CHANNEL_ID=1397271405606998036
PROJECTS_CATEGORY_ID=1396930022941397079
```

---

## Key Files Changed

1. **src/services/mondayWebhook.js** - Branch routing for webhook-created threads
2. **src/services/mondayApi.js** - Extended with getESSProjects(), isMondayConfigured()
3. **src/services/projectSyncOrchestrator.js** - New file, handles manual sync logic
4. **src/commands/mondaySyncProjects.js** - New file, the /monday-sync-projects command

---

## Deployment Reminder

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

## To Resume

1. Fix the permission issue on `non-walmart-project-reports` channel in Discord
2. Re-run `/monday-sync-projects` to sync the 4 failed projects
3. Test webhook-based routing by creating a new item in Monday.com with different Branch values
