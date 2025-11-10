import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

/**
 * Check for updates to the CLI tool
 * @returns Promise resolving to update info or null if no update needed
 */
export const checkForUpdates = async (): Promise<UpdateInfo | null> => {
  try {
    // Get current version from package.json
    // Use require to get the current installed package version
    const packageData = require('../package.json');
    const currentVersion = packageData.version;

    // Get the latest version from npm registry
    const response = await fetch('https://registry.npmjs.org/@coder/cli/latest');
    
    if (!response.ok) {
      // If we can't reach the registry, just return null
      return null;
    }
    
    const latestPackageData = await response.json() as { version: string };
    const latestVersion = latestPackageData.version;
    
    if (isVersionNewer(latestVersion, currentVersion)) {
      return {
        currentVersion,
        latestVersion,
        updateAvailable: true
      };
    }
    
    return {
      currentVersion,
      latestVersion,
      updateAvailable: false
    };
  } catch (error) {
    // If there's an error checking for updates, just return null
    // This prevents breaking the CLI if the registry is unavailable
    return null;
  }
};

/**
 * Display update notification if an update is available
 */
export const displayUpdateNotification = async (): Promise<void> => {
  const updateInfo = await checkForUpdates();
  
  if (updateInfo && updateInfo.updateAvailable) {
    console.log('');
    console.log(chalk.yellow('┌─────────────────────────────────────────────────────────┐'));
    console.log(chalk.yellow('│                   🚀 UPDATE AVAILABLE                   │'));
    console.log(chalk.yellow('├─────────────────────────────────────────────────────────┤'));
    console.log(chalk.yellow(`│  Current Version: ${updateInfo.currentVersion.padEnd(36)} │`));
    console.log(chalk.yellow(`│  Latest Version:  ${updateInfo.latestVersion.padEnd(36)} │`));
    console.log(chalk.yellow('├─────────────────────────────────────────────────────────┤'));
    console.log(chalk.yellow('│  Run the following command to update:                   │'));
    console.log(chalk.yellow('│  npm install -g @coder/cli@latest                       │'));
    console.log(chalk.yellow('└─────────────────────────────────────────────────────────┘'));
    console.log('');
  }
};

/**
 * Compare two version strings
 * @param version1 - The newer version to compare
 * @param version2 - The older version to compare
 * @returns true if version1 is newer than version2
 */
const isVersionNewer = (version1: string, version2: string): boolean => {
  const v1Parts = version1.split('.').map(Number);
  const v2Parts = version2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1 = v1Parts[i] || 0;
    const v2 = v2Parts[i] || 0;
    
    if (v1 > v2) return true;
    if (v1 < v2) return false;
  }
  
  return false; // Versions are equal
};

/**
 * Update information interface
 */
interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}