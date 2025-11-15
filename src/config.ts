import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import inquirer from 'inquirer';
import chalk from 'chalk';

// Define the structure of our configuration
export interface Config {
  apiUrl: string;
  apiKey?: string;
  timeout?: number; // Request timeout in milliseconds
}

const CONFIG_FILE_NAME = '.coder-cli-config.json';

// Get the config file path in the user's home directory
export const getConfigPath = (): string => {
  return path.join(os.homedir(), CONFIG_FILE_NAME);
};

// Load configuration from file
export const loadConfig = (): Config => {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      return fs.readJsonSync(configPath);
    } catch (error) {
      console.error('Error reading config file:', error);
      return getDefaultConfig();
    }
  }

  console.warn('Configuration file not found, using default settings.');
  return getDefaultConfig();
};

// Save configuration to file
export const saveConfig = (config: Config): void => {
  const configPath = getConfigPath();
  fs.writeJsonSync(configPath, config, { spaces: 2 });
};

// Get default configuration
const getDefaultConfig = (): Config => {
  return {
    apiUrl: 'https://coder-ai.mvstream.workers.dev/api', // Production backend base URL
    apiKey: undefined,
    timeout: 30000, // 30 seconds default timeout
  };
};

// Initialize configuration interactively
export const initializeConfig = async (): Promise<void> => {
  console.log('Setting up Coder CLI configuration...');
  console.log('Connecting to: https://coder-ai.mvstream.workers.dev/api');

  const configPath = getConfigPath();

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'Configuration already exists. Do you want to update it?',
        default: false,
      }
    ]);

    if (!overwrite) {
      console.log('Configuration unchanged.');
      return;
    }
  }

  // Inform user about API key generation
  console.log(chalk.yellow('\nTo get your API key:'));
  console.log(chalk.yellow('- Visit: https://coder-ai.pages.dev/'));
  console.log(chalk.yellow('- Generate a new API key'));
  console.log(chalk.yellow('- Then paste it below\n'));

  // Get API key only
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'apiKey',
      message: chalk.green('Enter your API key (required):'),
      default: ''
    }
  ]);

  const config: Config = {
    apiUrl: 'https://coder-ai.mvstream.workers.dev/api',
    apiKey: answers.apiKey || undefined,
    timeout: 120000 // 120 seconds default timeout
  };

  saveConfig(config);
  console.log('Configuration saved successfully!');
};