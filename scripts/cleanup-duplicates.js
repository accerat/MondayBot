// scripts/cleanup-duplicates.js
// One-time script to delete 0-message duplicate threads and clean up thread-mapping.json
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAPPING_FILE = path.join(__dirname, '../data/thread-mapping.json');

// All 0-message duplicate thread IDs to delete
const THREADS_TO_DELETE = [
  // 2/20/2026 batch (all 0 msgs)
  '1474390213198348338', // 1808.1000 Steamboat Springs, CO
  '1474390211831005338', // 5051.1006 Greeley, CO
  '1474390210518192221', // 924.1005 Sterling, CO
  '1474390209297645599', // 2227.1005 Abington, MA
  '1474390176703844474', // 5728.1003 Newburgh, IN
  '1474390174619275418', // 94.1002 Millington, TN
  '1474390173524693053', // 4272.1002 Logan, UT
  '1474390167879024680', // What the owner supplied materials look like
  '1474390166276673618', // GC Guidelines (See Files)
  '1474390164670255187', // Paint Codes
  '1474390162367578213', // Pre-Con Forms + Dura Surveys (See Files)

  // 2/10/2026 batch (all 0 msgs)
  '1470767546813907005', // 3533.1000 Denver, CO
  '1470767545761005638', // 3018.1001 Fountain, CO
  '1470767543806328904', // 1783.1002 Princeton, IN
  '1470767542158102781', // 1293.1009 Augusta, GA
  '1470767541440876776', // 1984.1003 North Adams, MA
  '1470767539381342257', // 4616.1004 Cleveland, GA
  '1470767538068521081', // 1095.1000 Glenwood Springs, CO
  '1470766460568862760', // 1434.1004 Colorado Springs, CO
  '1470766459612303471', // 4335.1002 Falcon, CO
  '1470766458190565552', // 4284.1002 Lakewood, CO
  '1470766457758548048', // 143.1003 Benton, KY
  '1470766456906977291', // 410.1004 Murray, KY
  '1470766421079228527', // 3267.1001 Omaha, NE
  '1470766419850297469', // 2012.1003 North Oxford, MA
  '1470766418554257481', // 5293.1002 Valley Stream, NY
  '1470766417262678232', // 3439.1008 Navarre, FL
  '1470766416654499943', // 3570.1007 Evans, GA
  '1470766415966502992', // 1180.1003 Greensburg, IN
  '1470766414628655236', // 817.1006 Kissimmee, FL
  '1470766412921311367', // 689.1004 Somerset, KY
  '1470766411931455631', // 1530.1003 Cleveland, MS
  '1470766410992189542', // 1327.1006 Madison, IN
  '1470766375382290555', // 566.1002 Booneville, IN
  '1470766374832836690', // 3461.1004 Peachtree City, GA
  '1470766373851365388', // 870.1004 Jasper, IN
  '1470766373419483196', // 3403.1010 Dallas, GA
  '1470766372161192078', // 2019.1004 Uniontown, PA
  '1470766368503631874', // 1723.1001 Des Moines, IA
  '1470766367434080338', // 673.1002 Clarksville, TN
  '1470766366721048723', // 1162.1002 Washington, IN
  '1470766331669250098', // 1614 w 26th
  '1470766330125750294', // 406 & 413 w 32nd street
  '1470766328687231048', // caves
  '1470766327672078400', // 1026.1002 Bedford, IN
  '1470766326225047552', // 4588.1007 Orlando, FL
  '1470766325172535419', // 1676.1001 Tell City, IN
  '1470766324270497915', // 2691.1003 New Albany, IN
  '1470766323679363175', // 994.1011 New Port Richey, FL
  '1470766322953486478', // 174.1005 Cocoa, FL
  '1470766299373240440', // Fixture anchoring details
  '1470766296995070038', // What the owner supplied materials (2/10 copy)
  '1470766294696722637', // Survey - general note
  '1470766291936870663', // Von Duprin Install Instructions
  '1470766290187583498', // Other ACC hardware cut sheets
  '1470766288648274114', // Template Push Checklist
  '1470766285209075712', // GC Guidelines (See Files) (2/10 copy)
  '1470766282537304154', // Paint Codes (2/10 copy)
  '1470766280205275289', // Store Sign Off Templete (See Files)
  '1470766278292537416', // Pre-Con Forms + Dura Surveys (2/10 copy)

  // Archived 0-msg duplicates from triple sets
  '1463241970011996170', // 3461.1004 Peachtree City, GA (1/20 archived)
  '1463241930761568342', // 890.1010 Orlando, FL (1/20 archived)
];

const deleteSet = new Set(THREADS_TO_DELETE);

async function main() {
  console.log(`\n=== Duplicate Thread Cleanup ===`);
  console.log(`Threads to delete: ${THREADS_TO_DELETE.length}\n`);

  // Step 1: Clean up thread-mapping.json (remove entries pointing to deleted threads)
  console.log('--- Step 1: Cleaning thread-mapping.json ---');
  try {
    const data = await fs.readFile(MAPPING_FILE, 'utf8');
    const mapping = JSON.parse(data);
    let removedCount = 0;

    for (const [mondayId, entry] of Object.entries(mapping.mappings)) {
      if (deleteSet.has(entry.threadId)) {
        console.log(`  Removing mapping: ${entry.projectName} (Monday ${mondayId} -> thread ${entry.threadId})`);
        delete mapping.mappings[mondayId];
        removedCount++;
      }
    }

    mapping.lastUpdated = new Date().toISOString();
    await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf8');
    console.log(`  Removed ${removedCount} stale mappings\n`);
  } catch (error) {
    console.error('  Error updating mapping file:', error.message);
  }

  // Step 2: Connect to Discord and delete threads
  console.log('--- Step 2: Deleting duplicate threads from Discord ---');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  await client.login(process.env.BOT_TOKEN);
  await new Promise(resolve => client.once('ready', resolve));
  console.log(`  Logged in as ${client.user.tag}\n`);

  let deleted = 0;
  let failed = 0;

  for (const threadId of THREADS_TO_DELETE) {
    try {
      const thread = await client.channels.fetch(threadId);
      if (thread) {
        const name = thread.name;
        await thread.delete('Cleanup: removing 0-message duplicate thread');
        console.log(`  DELETED: "${name}" (${threadId})`);
        deleted++;
      } else {
        console.log(`  SKIP: thread ${threadId} not found (already deleted?)`);
      }
    } catch (error) {
      if (error.code === 10003 || error.code === 10004) {
        console.log(`  SKIP: thread ${threadId} not found (already deleted?)`);
      } else {
        console.error(`  FAILED: thread ${threadId} - ${error.message}`);
        failed++;
      }
    }

    // Rate limit: 250ms between deletes
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  console.log(`\n=== Cleanup Complete ===`);
  console.log(`Deleted: ${deleted}`);
  console.log(`Failed: ${failed}`);
  console.log(`\nRemaining duplicates (both have messages) need manual review:`);
  console.log(`  - 1492.1003 Aurora, CO: 5 msgs vs 17 msgs`);
  console.log(`  - 980.1005 Greeley, CO: 3 msgs vs 21 msgs`);
  console.log(`  - 5334.1002 Aurora, CO: 5 msgs vs 23 msgs`);
  console.log(`  - 430.1003 Mayfield, KY: 4 msgs vs 18 msgs`);
  console.log(`  - 780.1003 Monroe, GA: 4 msgs vs 15 msgs`);
  console.log(`  - 3403.1010 Dallas, GA: 13 msgs vs 2 msgs (after 0-msg copy deleted)`);

  client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
