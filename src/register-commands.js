// src/register-commands.js
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commands = [];
const commandsPath = join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = join(commandsPath, file);
  const command = await import(`file://${filePath}`);
  if (command.data) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST().setToken(process.env.BOT_TOKEN);

try {
  console.log('Registering slash commands...');

  await rest.put(
    Routes.applicationGuildCommands(process.env.APP_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log('Successfully registered slash commands!');
} catch (error) {
  console.error('Error registering commands:', error);
}
