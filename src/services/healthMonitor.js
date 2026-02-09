// src/services/healthMonitor.js
// Monitors bot health and alerts on issues

let consecutiveFailures = 0;
let lastAlertDate = null;

/**
 * Initialize health monitoring
 * @param {Client} client - Discord client
 */
export function initializeHealthMonitor(client) {
  // Check every 5 minutes
  setInterval(async () => {
    await performHealthCheck(client);
  }, 5 * 60 * 1000);

  // Initial check after 30 seconds
  setTimeout(() => performHealthCheck(client), 30 * 1000);

  console.log('[health-monitor] Initialized - checking every 5 min');
}

/**
 * Perform health check on all services
 */
async function performHealthCheck(client) {
  try {
    // Check Monday.com API
    const mondayOk = await checkMondayAPI();

    // Check Discord connection
    const discordOk = client.isReady();

    if (!mondayOk || !discordOk) {
      consecutiveFailures++;
      console.error(`[health-monitor] Check failed - Monday: ${mondayOk}, Discord: ${discordOk}`);

      // Alert after 3 consecutive failures (once per day)
      const today = new Date().toISOString().split('T')[0];
      if (consecutiveFailures >= 3 && lastAlertDate !== today) {
        await sendHealthAlert(client, { mondayOk, discordOk });
        lastAlertDate = today;
      }
    } else {
      if (consecutiveFailures > 0) {
        console.log('[health-monitor] Services recovered');
      }
      consecutiveFailures = 0;
    }
  } catch (error) {
    console.error('[health-monitor] Check error:', error);
    consecutiveFailures++;
  }
}

/**
 * Check Monday.com API connectivity
 * @returns {Promise<boolean>} True if API is healthy
 */
async function checkMondayAPI() {
  try {
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Authorization': process.env.MONDAY_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: 'query { me { id } }' })
    });
    const data = await response.json();
    return !data.errors;
  } catch {
    return false;
  }
}

/**
 * Send health alert to flag channel
 */
async function sendHealthAlert(client, status) {
  const flagChannelId = process.env.FLAG_CHANNEL_ID;
  if (!flagChannelId) return;

  try {
    const channel = await client.channels.fetch(flagChannelId);
    if (!channel) return;

    let message = `**MondayBot Health Alert**\n\n`;
    message += `**Service Status:**\n`;
    message += `Monday.com API: ${status.mondayOk ? 'OK' : 'FAILED'}\n`;
    message += `Discord: ${status.discordOk ? 'OK' : 'FAILED'}\n\n`;
    message += `Consecutive failures: ${consecutiveFailures}\n`;
    message += `*This is the first alert today.*`;

    await channel.send(message);
    console.log('[health-monitor] Sent alert to flag channel');
  } catch (error) {
    console.error('[health-monitor] Failed to send alert:', error);
  }
}

/**
 * Get current health status
 * @returns {object} Current health status
 */
export function getHealthStatus() {
  return {
    consecutiveFailures,
    lastAlertDate,
    isHealthy: consecutiveFailures === 0
  };
}
