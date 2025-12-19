#!/bin/bash
# MondayBot AWS Deployment Script
# Run this on the AWS server: ubuntu@18.118.203.113

set -e  # Exit on error

echo "🚀 Starting MondayBot deployment..."

# Navigate to bots directory
cd /home/ubuntu/bots

# Clone repository
if [ -d "MondayBot" ]; then
  echo "📂 MondayBot directory exists, pulling latest changes..."
  cd MondayBot
  git pull origin main
else
  echo "📥 Cloning MondayBot repository..."
  git clone https://github.com/accerat/MondayBot.git
  cd MondayBot
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create .env file - NOTE: You need to manually add your tokens!
if [ ! -f .env ]; then
  echo "📝 Creating .env template..."
  cat > .env << 'EOF'
# Discord Bot Configuration
BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
APP_ID=YOUR_APP_ID_HERE
GUILD_ID=1396930021817581732

# Monday.com Configuration
MONDAY_API_TOKEN=YOUR_MONDAY_API_TOKEN_HERE
MONDAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET

# Webhook Server Configuration
WEBHOOK_PORT=3001

# Discord Projects Category ID
PROJECTS_CATEGORY_ID=1396930022941397079
EOF
  echo "⚠️  .env template created - YOU MUST EDIT IT WITH YOUR ACTUAL TOKENS!"
  echo "    Edit with: nano .env"
  echo ""
  read -p "Press Enter after you've updated .env with your tokens..."
else
  echo "✅ .env file already exists"
fi

# Create data directory and copy thread mappings from TaskBot
echo "📋 Setting up thread mappings..."
mkdir -p data

# Check if TaskBot's mapping exists and copy it
if [ -f "../taskbot/data/project-sync-state.json" ]; then
  echo "📥 Found TaskBot mappings, converting to MondayBot format..."
  node -e "
const fs = require('fs');
const taskBotData = JSON.parse(fs.readFileSync('../taskbot/data/project-sync-state.json', 'utf8'));
const mondayBotMapping = { mappings: {}, lastUpdated: new Date().toISOString() };
let count = 0;
for (const [mondayItemId, projectData] of Object.entries(taskBotData.syncedProjects)) {
  if (projectData.created?.discord?.threadId) {
    mondayBotMapping.mappings[mondayItemId] = {
      threadId: projectData.created.discord.threadId,
      projectName: projectData.projectName,
      mappedAt: projectData.syncedAt || new Date().toISOString()
    };
    count++;
  }
}
fs.writeFileSync('data/thread-mapping.json', JSON.stringify(mondayBotMapping, null, 2));
console.log('✅ Converted ' + count + ' thread mappings');
"
else
  echo "⚠️ TaskBot mappings not found, you'll need to sync them manually"
fi

# Register Discord commands
echo "🎮 Registering Discord commands..."
npm run register

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
  echo "📦 Installing PM2..."
  npm install -g pm2
fi

# Start or restart with PM2
if pm2 list | grep -q "MondayBot"; then
  echo "🔄 Restarting MondayBot with PM2..."
  pm2 restart MondayBot --update-env
else
  echo "▶️ Starting MondayBot with PM2..."
  pm2 start src/index.js --name MondayBot
  pm2 save
fi

# Show status
echo ""
echo "✅ MondayBot deployment complete!"
echo ""
echo "📊 Status:"
pm2 list
echo ""
echo "📝 View logs with: pm2 logs MondayBot"
echo ""
echo "🌐 Webhook URL: http://18.118.203.113:3001/webhook/monday"
echo "   ⚠️ Configure this URL in Monday.com webhooks"
echo ""
