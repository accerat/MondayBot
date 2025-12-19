// Script to sync thread mappings from TaskBot to MondayBot
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read TaskBot's mapping file
const taskBotMappingPath = 'C:\\Users\\blitz\\bots\\taskbot\\data\\project-sync-state.json';
const taskBotData = JSON.parse(fs.readFileSync(taskBotMappingPath, 'utf8'));

// Convert to MondayBot format
const mondayBotMapping = {
  mappings: {},
  lastUpdated: new Date().toISOString()
};

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

// Ensure data directory exists
const dataDir = join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Write to MondayBot's mapping file
const mondayBotMappingPath = join(dataDir, 'thread-mapping.json');
fs.writeFileSync(mondayBotMappingPath, JSON.stringify(mondayBotMapping, null, 2));

console.log(`✅ Synced ${count} thread mappings from TaskBot to MondayBot`);
console.log(`📁 Mapping file: ${mondayBotMappingPath}`);
