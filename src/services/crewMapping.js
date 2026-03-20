// src/services/crewMapping.js
// MondayBot wrapper for the shared crew mapping module

import { createCrewMapping } from '../../../shared/crewMapping.js';
import { loadFromDrive, saveToDrive } from '../utils/driveStorage.js';

const crewMapping = createCrewMapping({
  botName: 'MondayBot',
  loadFn: () => loadFromDrive('crew-mapping', {}),
  saveFn: (data) => saveToDrive('crew-mapping', data),
});

export async function initializeCrewMapping() {
  await crewMapping.initialize();
}

export const {
  getDiscordUser,
  getCrewName,
  getCrewNames,
  getAll,
  isLinked,
  getEntry,
} = crewMapping;
