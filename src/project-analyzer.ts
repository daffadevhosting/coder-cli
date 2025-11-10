import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

// Define file extensions that are typically code files
const CODE_FILE_EXTENSIONS = [
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', 
  '.go', '.rs', '.rb', '.php', '.html', '.css', '.scss', '.sql', 
  '.json', '.yaml', '.yml', '.md', '.sh', '.bash', '.zsh'
];

// Define files that are typically important for project context
const IMPORTANT_FILES = [
  'package.json', 'requirements.txt', 'setup.py', 'Dockerfile', 
  'Makefile', 'README.md', 'CHANGELOG.md', 'LICENSE', 
  'requirements-dev.txt', 'Gemfile', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', '.gitignore', 'tsconfig.json', 'webpack.config.js'
];

// Define directories to exclude from analysis
const EXCLUDED_DIRS = [
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 
  'coverage', '.next', '.nuxt', '__pycache__', '.pytest_cache',
  'target', 'vendor', '.vscode', '.idea', 'tmp', 'temp'
];

/**
 * Analyze a project directory and return its structure and important files
 * @param projectPath - Path to the project directory
 * @returns Project analysis result
 */
export const analyzeProject = async (projectPath: string): Promise<ProjectAnalysisResult> => {
  console.log(`Analyzing project at: ${projectPath}`);
  
  if (!await fs.pathExists(projectPath)) {
    if (projectPath === process.cwd()) {
      throw new Error(`Current directory does not exist or is not accessible: ${projectPath}\nPlease navigate to a valid project directory or specify a path explicitly.`);
    } else {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }
  }
  
  if (!await fs.stat(projectPath).then(stat => stat.isDirectory())) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }
  
  // Get the project structure
  const structure = await getProjectStructure(projectPath);
  
  // Get important configuration files
  const configFiles = await getConfigFiles(projectPath);
  
  // Get code files
  const codeFiles = await getCodeFiles(projectPath);
  
  // Get code content
  const codeContent = await getCodeContent(codeFiles);
  
  console.log(`Found ${structure.directories.length} directories and ${structure.files.length} files`);
  console.log(`Identified ${configFiles.length} configuration files`);
  console.log(`Found ${codeFiles.length} code files`);
  
  return {
    path: projectPath,
    structure,
    configFiles,
    codeFiles,
    codeContent,
    summary: generateProjectSummary(structure, configFiles, codeContent)
  };
};

/**
 * Get project structure (directories and files)
 * @param projectPath - Path to the project directory
 * @returns Project structure
 */
const getProjectStructure = async (projectPath: string): Promise<ProjectStructure> => {
  const directories: string[] = [];
  const files: string[] = [];
  
  const walk = async (currentPath: string) => {
    const items = await fs.readdir(currentPath);
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const relativePath = path.relative(projectPath, fullPath);
      
      const stat = await fs.stat(fullPath);
      
      if (stat.isDirectory()) {
        // Skip excluded directories
        if (!EXCLUDED_DIRS.includes(item)) {
          directories.push(relativePath);
          await walk(fullPath); // Recursive call for subdirectories
        }
      } else {
        files.push(relativePath);
      }
    }
  };
  
  await walk(projectPath);
  
  return {
    directories: directories.sort(),
    files: files.sort()
  };
};

/**
 * Get important configuration files
 * @param projectPath - Path to the project directory
 * @returns List of configuration files with their content
 */
const getConfigFiles = async (projectPath: string): Promise<ConfigFile[]> => {
  const configFiles: ConfigFile[] = [];
  
  for (const configFile of IMPORTANT_FILES) {
    const fullPath = path.join(projectPath, configFile);
    
    if (await fs.pathExists(fullPath)) {
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        configFiles.push({
          name: configFile,
          path: fullPath,
          relativePath: configFile,
          content: content
        });
      } catch (error) {
        console.warn(`Could not read config file ${fullPath}:`, error);
      }
    }
  }
  
  return configFiles;
};

/**
 * Get code files in the project
 * @param projectPath - Path to the project directory
 * @returns List of code file paths
 */
const getCodeFiles = async (projectPath: string): Promise<string[]> => {
  // Create glob pattern for code files
  const patterns = CODE_FILE_EXTENSIONS.map(ext => `**/*${ext}`);
  
  // Find all code files in the project
  const allCodeFiles: string[] = [];
  
  for (const pattern of patterns) {
    const files = await glob(pattern, {
      cwd: projectPath,
      ignore: EXCLUDED_DIRS.map(dir => `**/${dir}/**`),
      absolute: false // We want relative paths
    });
    
    allCodeFiles.push(...files);
  }
  
  // Remove duplicates and sort
  return [...new Set(allCodeFiles)].sort();
};

/**
 * Get content of code files
 * @param filePaths - List of file paths
 * @returns Mapping of file paths to their content
 */
const getCodeContent = async (filePaths: string[]): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  
  for (const filePath of filePaths) {
    try {
      const fullPath = path.join(process.cwd(), filePath); // Adjust path as needed
      const content = await fs.readFile(fullPath, 'utf8');
      
      // Limit content size to prevent sending too much data to the AI
      result[filePath] = content.length > 10000 ? content.substring(0, 10000) + '...' : content;
    } catch (error) {
      console.warn(`Could not read code file ${filePath}:`, error);
    }
  }
  
  return result;
};

/**
 * Generate a summary of the project
 * @param structure - Project structure
 * @param configFiles - Configuration files
 * @param codeContent - Code content
 * @returns Project summary
 */
const generateProjectSummary = (
  structure: ProjectStructure, 
  configFiles: ConfigFile[], 
  codeContent: Record<string, string>
): string => {
  const lines: string[] = [];
  
  lines.push(`Project Structure:`);
  lines.push(`  Directories (${structure.directories.length}):`);
  lines.push(`    ${structure.directories.slice(0, 10).join(', ')}`);
  if (structure.directories.length > 10) {
    lines.push(`    ... and ${structure.directories.length - 10} more`);
  }
  
  lines.push(`  Files (${structure.files.length}):`);
  lines.push(`    ${structure.files.slice(0, 10).join(', ')}`);
  if (structure.files.length > 10) {
    lines.push(`    ... and ${structure.files.length - 10} more`);
  }
  
  lines.push(`\nConfiguration Files (${configFiles.length}):`);
  for (const configFile of configFiles) {
    lines.push(`  - ${configFile.name}`);
  }
  
  const totalCodeFiles = Object.keys(codeContent).length;
  const totalCodeSize = Object.values(codeContent).reduce((sum, content) => sum + content.length, 0);
  
  lines.push(`\nCode Files: ${totalCodeFiles} files, ~${totalCodeSize} characters`);
  
  return lines.join('\n');
};

// Type definitions
export interface ProjectStructure {
  directories: string[];
  files: string[];
}

export interface ConfigFile {
  name: string;
  path: string;
  relativePath: string;
  content: string;
}

export interface ProjectAnalysisResult {
  path: string;
  structure: ProjectStructure;
  configFiles: ConfigFile[];
  codeFiles: string[];
  codeContent: Record<string, string>;
  summary: string;
}