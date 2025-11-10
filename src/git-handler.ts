import { exec } from 'child_process';
import { promisify } from 'util';
import tmp from 'tmp-promise';
import fs from 'fs-extra';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Clone a public repository to a temporary directory
 * @param repoUrl - URL of the public repository to clone
 * @returns Path to the cloned repository
 */
export const cloneRepository = async (repoUrl: string): Promise<string> => {
  // Validate repository URL
  if (!isValidRepoUrl(repoUrl)) {
    throw new Error(`Invalid repository URL: ${repoUrl}`);
  }
  
  console.log(`Cloning repository from: ${repoUrl}`);
  
  // Create a temporary directory for the cloned repo
  const { path: tempDir, cleanup } = await tmp.dir({ prefix: 'coder-cli-repo-' });
  
  try {
    // Execute git clone command
    await execAsync(`git clone ${repoUrl} "${tempDir}"`);
    
    console.log(`Repository cloned successfully to: ${tempDir}`);
    
    // Register cleanup function to be called when needed
    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(2);
    });
    process.on('SIGUSR1', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGUSR2', () => {
      cleanup();
      process.exit(0);
    });
    
    return tempDir;
  } catch (error) {
    console.error(`Failed to clone repository: ${error}`);
    
    // Clean up the temporary directory if cloning failed
    await cleanup();
    
    throw new Error(`Failed to clone repository: ${(error as Error).message}`);
  }
};

/**
 * Validate if the given string is a valid repository URL
 * @param repoUrl - Repository URL to validate
 * @returns True if valid, false otherwise
 */
const isValidRepoUrl = (repoUrl: string): boolean => {
  try {
    // Basic validation for HTTP/HTTPS and Git URLs
    const url = new URL(repoUrl);
    const isValidProtocol = ['http:', 'https:'].includes(url.protocol);
    const looksLikeGitRepo = repoUrl.endsWith('.git') || url.hostname === 'github.com' || url.hostname === 'gitlab.com' || url.hostname === 'bitbucket.org';
    
    return isValidProtocol && looksLikeGitRepo;
  } catch {
    // If URL parsing fails, check if it looks like a Git SSH URL
    return /^[\w-]+@[\w.-]+:[\w./-]+\.git$/.test(repoUrl);
  }
};

/**
 * Get repository info from a local path
 * @param repoPath - Path to the local repository
 * @returns Repository information
 */
export const getRepoInfo = async (repoPath: string): Promise<{ name: string; path: string; hasGit: boolean }> => {
  const repoName = path.basename(repoPath);
  const gitPath = path.join(repoPath, '.git');
  const hasGit = await fs.pathExists(gitPath);
  
  return {
    name: repoName,
    path: repoPath,
    hasGit: hasGit
  };
};