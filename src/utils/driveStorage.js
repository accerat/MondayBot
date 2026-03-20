// src/utils/driveStorage.js
// Wrapper for shared Drive storage module

import dotenv from 'dotenv';
dotenv.config();

import { createMultiFileDriveStorage } from '../../../shared/driveStorage.js';

const storage = createMultiFileDriveStorage({
  botName: 'MondayBot',
  files: {
    'crew-mapping': 'CREW_MAPPING_DRIVE_ID'
  }
});

export const {
  loadFromDrive,
  saveToDrive,
  isDriveConfigured
} = storage;
