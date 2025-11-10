#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { analyzeProject } from './project-analyzer';
import { cloneRepository } from './git-handler';
import { startChatSession } from './chat-handler';
import { loadConfig } from './config';
import { initializeConfig } from './setup';
import { handleUserError, logTechnicalError } from './errors';
import { displayUpdateNotification } from './version-checker';
import { displayBanner } from './banner';

// Display the banner
displayBanner();

// Load configuration
const config = loadConfig();

// Check for updates (non-blocking)
// Using setImmediate to run this asynchronously without blocking
setImmediate(() => {
  // Run update check without awaiting to avoid blocking the CLI
  displayUpdateNotification().catch(() => {
    // Silently fail if update check fails to avoid disrupting the user
  });
});

// Dynamically get the package version
const packageJson = require('../package.json');
const packageVersion = packageJson.version;

program
  .name('coder-cli')
  .description('AI-powered coding assistant - coder-cli (formerly CoDa Code)')
  .version(packageVersion);

program
  .command('init')
  .description('Initialize the CLI tool with your AI backend configuration')
  .action(async () => {
    try {
      await initializeConfig();
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze a local project directory')
  .argument('[path]', 'path to the project directory (defaults to current directory)')
  .option('-o, --output <format>', 'output format (json, text)', 'text')
  .action(async (path) => {
    try {
      const projectPath = path || process.cwd();
      await analyzeProject(projectPath);
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

program
  .command('chat')
  .description('Start an interactive chat session with code context')
  .option('-p, --project <path>', 'path to project directory (defaults to current directory if no repo specified)')
  .option('-r, --repo <url>', 'URL of public repository')
  .option('--no-stream', 'disable streaming responses')
  .action(async (options) => {
    try {
      let contextPath = options.repo;
      
      if (options.project) {
        // If a project path is explicitly specified, analyze it
        await analyzeProject(options.project);
        contextPath = options.project;
      }
      
      if (options.repo) {
        await cloneRepository(options.repo);
        contextPath = options.repo;
      }
      
      await startChatSession(config, contextPath, options.stream);
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

program
  .command('fix')
  .description('Fix code issues in a project')
  .argument('[path]', 'path to the project directory (defaults to current directory)')
  .option('-i, --issue <description>', 'describe the issue to fix')
  .action(async (path, options) => {
    try {
      const projectPath = path || process.cwd();
      await analyzeProject(projectPath);
      await startChatSession(config, projectPath, true, {
        mode: 'fix',
        issueDescription: options.issue
      });
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

program
  .command('create')
  .description('Create new code in a project')
  .argument('[path]', 'path to the project directory (defaults to current directory)')
  .option('-s, --spec <specification>', 'specify what to create')
  .action(async (path, options) => {
    try {
      const projectPath = path || process.cwd();
      await analyzeProject(projectPath);
      await startChatSession(config, projectPath, true, {
        mode: 'create',
        specification: options.spec
      });
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

// Add global error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
  logTechnicalError(reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught Exception:'), error);
  logTechnicalError(error);
  process.exit(1);
});

program.parse(process.argv);