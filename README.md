# MondayBot

**ALL Monday.com related functionality lives in this bot.**

Bidirectional sync between Monday.com and Discord. Automatically posts Monday.com updates to Discord threads and allows field teams to update Monday.com from Discord using @MondayBot mentions.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/monday-sync-projects` | Manually sync Monday.com ESS projects to Discord threads |
| `/monday-status` | Check bot status and recent thread mappings |
| `/project-info` | Display project details (use in a project thread) |

## Features

### Branch-Based Channel Routing
New projects are automatically routed to the correct Discord channel based on the "Branch" column:
- **ESS** → Channel 1456320404330381425
- **OPD** → Channel 1446176868695937084
- **Other/Empty** → Channel 1397270791175012453
- **Multiple branches selected** → Flagged to Channel 1397271405606998036 (no thread created)

### Monday.com → Discord (Automatic via Webhooks)
- Field changes (status, dates, assignments)
- New comments/updates
- File uploads
- Status changes

### Discord → Monday.com (@MondayBot Commands)
- Add updates/notes
- Change status
- Upload files with photos
- Quick updates (just mention the bot)

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create `.env` file:
```env
BOT_TOKEN=your_discord_bot_token
APP_ID=your_app_id
GUILD_ID=your_guild_id
MONDAY_API_TOKEN=your_monday_api_token
WEBHOOK_PORT=3001
PROJECTS_CATEGORY_ID=your_category_id
```

### 3. Create Discord Bot
1. Go to Discord Developer Portal
2. Create new application
3. Enable these intents:
   - SERVER MEMBERS INTENT
   - MESSAGE CONTENT INTENT
4. Invite bot with permissions:
   - Read Messages/View Channels
   - Send Messages
   - Send Messages in Threads
   - Add Reactions

### 4. Register Commands
```bash
npm run register
```

### 5. Start Bot
```bash
npm start
```

## Usage

### @MondayBot Commands (in project threads)

**Add Update:**
```
@MondayBot update Materials delivered to site
@MondayBot note Crew size increased to 8 workers
```

**Change Status:**
```
@MondayBot status In Progress
@MondayBot status Complete
```

**Upload Files:**
```
@MondayBot attach [attach files] Site progress photos from today
```

**Quick Update:**
```
@MondayBot Foundation work completed ahead of schedule
```

**Help:**
```
@MondayBot help
```

## Monday.com Webhook Setup

1. Go to Monday.com → Integrations → Webhooks
2. Create webhook with URL: `http://YOUR_AWS_IP:3001/webhook/monday`
3. Select events:
   - Column value changed
   - Status changed
   - Update created
   - File uploaded

## Architecture

```
Monday.com → Webhook → MondayBot (AWS) → Discord Thread
Discord @mention → MondayBot → Monday.com API → Monday.com Item
```

## Deployment (AWS)

```bash
# 1. Push to GitHub
git add -A
git commit -m "Initial MondayBot commit"
git push origin main

# 2. Deploy to AWS
ssh ubuntu@YOUR_AWS_IP
cd ~/bots
git clone https://github.com/accerat/MondayBot.git
cd MondayBot
npm install
npm run register

# 3. Start with PM2
pm2 start src/index.js --name MondayBot
pm2 save

# 4. View logs
pm2 logs MondayBot
```

## File Structure

```
MondayBot/
├── src/
│   ├── index.js                      # Main bot + webhook server
│   ├── register-commands.js          # Command registration
│   ├── commands/
│   │   ├── mondayStatus.js           # /monday-status command
│   │   ├── mondaySyncProjects.js     # /monday-sync-projects command
│   │   └── projectInfo.js            # /project-info command
│   └── services/
│       ├── mondayApi.js              # Monday.com API client
│       ├── mondayWebhook.js          # Webhook handler (Monday → Discord)
│       ├── mondayMentionHandler.js   # Mention handler (Discord → Monday)
│       ├── projectSyncOrchestrator.js # Project sync logic
│       └── threadMapper.js           # Thread ID mapping
├── data/
│   ├── thread-mapping.json           # Monday item ID ↔ Discord thread ID
│   └── project-sync-state.json       # Sync state tracking
├── .env                              # Configuration
├── package.json
└── README.md
```

## Environment Variables

```env
# Discord
BOT_TOKEN=your_discord_bot_token
APP_ID=your_app_id
GUILD_ID=your_guild_id

# Monday.com
MONDAY_API_TOKEN=your_monday_api_token
WEBHOOK_PORT=3001

# Branch-based channel routing
ESS_CHANNEL_ID=1456320404330381425
OPD_CHANNEL_ID=1446176868695937084
DEFAULT_CHANNEL_ID=1397270791175012453
FLAG_CHANNEL_ID=1397271405606998036

# Legacy (fallback)
PROJECTS_CATEGORY_ID=1396930022941397079
```

## Deployment

**IMPORTANT: This bot runs on AWS, NOT locally.**

1. Edit code locally in `C:\Users\blitz\bots\MondayBot`
2. `git add` + `git commit` + `git push origin main`
3. SSH to AWS: `ssh -i /path/to/key admin@[AWS_IP]`
4. Deploy: `cd /home/admin/bots/MondayBot && git pull && npm run register && pm2 restart MondayBot --update-env`

## Support

For issues or questions, check the logs:
```bash
ssh admin@[AWS_IP] "pm2 logs MondayBot --lines 50"
```
