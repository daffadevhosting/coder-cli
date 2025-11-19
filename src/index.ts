#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { analyzeProject } from './project-analyzer';
import { cloneRepository } from './git-handler';
import { startChatSession, ChatMessage, buildApiUrl, startRedesignSession } from './chat-handler';
import { loadConfig, Config } from './config';
import { initializeConfig } from './setup';
import { handleUserError, logTechnicalError } from './errors';
import { displayUpdateNotification } from './version-checker';
import { displayBanner } from './banner';
import ora from 'ora';

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
      
      await startChatSession(config, contextPath, options.stream, { mode: 'chat' });
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

// Add new command for direct project creation
program
  .command('new')
  .description('Create a new project with specified technology stack')
  .argument('<name>', 'name of the project directory to create')
  .option('-t, --tech <technology>', 'technology stack (e.g., nextjs, vite, vanilla, react, vue, etc.)')
  .option('-s, --spec <specification>', 'project specification or features to include')
  .action(async (name, options) => {
    try {
      await createNewProject(config, name, options.tech, options.spec);
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

program
  .command('explain')
  .description('Get an AI explanation for a piece of code')
  .argument('<path>', 'path to the file containing the code to explain')
  .option('-l, --line <number>', 'specific line number to explain (optional)')
  .action(async (filePath, options) => {
    try {
      let resolvedPath: string | null = null;
      const currentCwd = process.cwd();
      // Assuming a monorepo structure where 'cli' is directly under the monorepo root
      const monorepoRoot = path.resolve(currentCwd, '..'); 

      // Define potential base paths to check against
      const potentialBasePaths = [
        currentCwd, // 1. Path relative to current CLI execution directory
        monorepoRoot, // 2. Path relative to monorepo root
      ];

      // If the input path starts with a slash, it might be an "absolute" path relative to the monorepo root
      // or a truly absolute path. We'll try resolving it directly first.
      if (filePath.startsWith('/') || filePath.startsWith('\\')) {
        const absoluteCandidate = path.resolve(filePath);
        if (fs.existsSync(absoluteCandidate)) {
          resolvedPath = absoluteCandidate;
        }
      }

      // If not found yet, try resolving relative to potential base paths
      if (!resolvedPath) {
        for (const basePath of potentialBasePaths) {
          // Remove leading slash if present for relative resolution against a base path
          const candidatePath = path.resolve(basePath, filePath.replace(/^[/\\]/, '')); 
          if (fs.existsSync(candidatePath)) {
            resolvedPath = candidatePath;
            break;
          }
        }
      }

      if (!resolvedPath) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      const fileContent = await fs.readFile(resolvedPath, 'utf8');
      let codeToExplain = fileContent;
      let explanationContext = `Explain the following code from file '${filePath}':\n\n\`\`\`\n${fileContent}\n\`\`\``;

      if (options.line) {
        const lines = fileContent.split('\n');
        const lineNumber = parseInt(options.line, 10);
        if (isNaN(lineNumber) || lineNumber < 1 || lineNumber > lines.length) {
          throw new Error(`Invalid line number: ${options.line}`);
        }
        codeToExplain = lines[lineNumber - 1];
        explanationContext = `Explain line ${lineNumber} from file '${filePath}':\n\n\`\`\`\n${codeToExplain}\n\`\`\``;
      }

      await startChatSession(config, undefined, true, {
        mode: 'explain',
        clientSystemPrompt: explanationContext
      });
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

program
  .command('create-script')
  .description('Generate a new script file with AI, tailored to your project context')
  .argument('<script-name>', 'name of the script file to create (e.g., "utils.js", "myComponent.tsx")')
  .argument('[path]', 'path to the project directory (defaults to current directory)')
  .option('-s, --spec <specification>', 'specify what the script should do (e.g., "a React component for a button", "a utility function for date formatting")')
  .action(async (scriptName, projectPathArg, options) => {
    try {
      const projectPath = projectPathArg || process.cwd();
      if (!options.spec) {
        throw new Error('Specification (-s, --spec) is required for creating a script.');
      }

      console.log(`Generating script: ${scriptName} in ${projectPath}`);
      console.log(`Specification: ${options.spec}`);

      // Analyze the project to provide context to the AI
      const projectContext = await analyzeProject(projectPath);

      // Construct the user message for AI
      const userMessage = `Generate a script file named "${scriptName}" that does the following: "${options.spec}".
      The script should be compatible with the existing project structure and technologies.
      Project context:
      ${projectContext}`;

      await startChatSession(config, projectPath, true, {
        mode: 'script',
        scriptName: scriptName,
        scriptSpecification: options.spec,
        clientSystemPrompt: userMessage
      });
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

program
  .command('redesign')
  .description('Re-design a web page from a given URL using AI')
  .argument('<url>', 'URL of the web page to re-design')
  .action(async (url) => {
    try {
      await startRedesignSession(config, url);
    } catch (error) {
      console.error(chalk.red(handleUserError(error)));
      logTechnicalError(error);
      process.exit(1);
    }
  });

/**
 * Create a new project with specified technology stack
 */
const createNewProject = async (config: import('./config').Config, projectName: string, technology?: string, specification?: string) => {
  console.log(`Creating new project: ${projectName}`);
  if (technology) {
    console.log(`Technology stack: ${technology}`);
  }
  if (specification) {
    console.log(`Specification: ${specification}`);
  }

  // Create project directory
  const projectPath = path.join(process.cwd(), projectName);
  if (fs.existsSync(projectPath)) {
    // Ask for confirmation before overwriting
    const overwrite = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Directory ${projectPath} already exists. Do you want to overwrite it? This will delete all existing files.`,
        default: false,
      }
    ]);

    if (!overwrite.overwrite) {
      console.log('Project creation cancelled.');
      return;
    }

    // Remove the existing directory and create a new one
    console.log(`Removing existing directory: ${projectPath}`);
    fs.removeSync(projectPath);
  }

  fs.mkdirSync(projectPath, { recursive: true });
  console.log(`Created directory: ${projectPath}`);

  // Generate project using AI
  let projectSpec = `Create a new ${technology ? technology : 'web'} project.`;
  if (specification) {
    projectSpec += ` The user wants: ${specification}.`;
  } else {
    projectSpec += ` Include basic structure and functionality.`;
  }
  projectSpec += ` Provide all necessary files, code, and configuration.`;

  const messages: ChatMessage[] = [
    { 
      role: 'system', 
      content: 'You are CoDa, helpful AI coding assistant that generates complete project files. Return the files in a structured JSON format with file paths and content. Format: {"files": [{"path": "file/path", "content": "file content"}]}' 
    },
    { 
      role: 'user', 
      content: projectSpec 
    }
  ];

  // Call the new project generation endpoint
  const endpointUrl = buildApiUrl(config.apiUrl, 'project');
  
  // Show a warning if no API key is configured
  if (!config.apiKey) {
    console.log(chalk.yellow('Warning: No API key configured. Project generation may be limited or fail.'));
    console.log(chalk.yellow('Run `coder-cli init` to configure your API key.'));
  }

  const spinner = ora('Generating project files with AI...').start();
  let response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({ 
        messages,
        mode: 'project',
        technology
      })
    });

    if (!response.ok) {
      spinner.stop();
      console.error(chalk.red(`API request failed: ${response.status} ${response.statusText}`));
      const errorText = await response.text();
      if (errorText) {
        console.error(chalk.red(`Error response: ${errorText}`));
      }
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    let files = data.files || [];

    // If no files found, try to parse from a 'response' field which might contain a JSON string
    if (files.length === 0 && typeof data.response === 'string') {
      try {
        let responseContent = data.response;
        // Check for markdown JSON block and extract content if it exists
        const match = responseContent.match(/```json\n([\s\S]*)\n```/);
        if (match && match[1]) {
          responseContent = match[1];
        }
        const nestedData = JSON.parse(responseContent);
        files = nestedData.files || [];
      } catch (e) {
        // data.response was not a valid JSON string, so we assume no files.
        console.log(chalk.dim('AI response did not contain a parsable file structure.'));
      }
    }
    spinner.stop();

    if (files.length === 0) {
      console.log(chalk.yellow('No files generated by AI. Creating basic structure...'));
      // Create basic structure if AI doesn't return files
      createBasicStructure(projectPath, technology, specification);
    } else {
      // Create the files returned by the AI
      for (const file of files) {
        const filePath = path.join(projectPath, file.path);
        const dirPath = path.dirname(filePath);
        
        // Create directory if it doesn't exist
        fs.mkdirSync(dirPath, { recursive: true });
        
        // Write file content
        fs.writeFileSync(filePath, file.content);
        console.log(`Created: ${file.path}`);
      }
    }

    console.log(`\nProject ${projectName} created successfully!`);
    console.log(`Navigate to the directory and run the appropriate setup command.`);
  } catch (error) {
    spinner.stop();
    throw error;
  }
};

const createBasicStructure = (projectPath: string, technology?: string, specification?: string) => {
  // Create a basic structure based on the technology
  switch (technology?.toLowerCase()) {
    case 'nextjs':
      createNextJSFiles(projectPath);
      break;
    case 'vite':
      createViteFiles(projectPath);
      break;
    case 'react':
      createReactFiles(projectPath);
      break;
    default:
      createVanillaFiles(projectPath, specification);
      break;
  }
};

const createVanillaFiles = (projectPath: string, specification?: string) => {
  // Check if specification mentions portfolio, dark mode, or similar terms
  const isPortfolio = specification && (specification.toLowerCase().includes('portfolio') || 
                                      specification.toLowerCase().includes('personal website') || 
                                      specification.toLowerCase().includes('cv') || 
                                      specification.toLowerCase().includes('resume'));
  
  if (isPortfolio) {
    // Create a more sophisticated portfolio structure
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Portfolio</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <!-- Navigation -->
    <nav class="navbar">
        <div class="nav-container">
            <div class="nav-logo">
                <a href="#home">Portfolio</a>
            </div>
            <ul class="nav-menu">
                <li class="nav-item">
                    <a href="#home" class="nav-link">Home</a>
                </li>
                <li class="nav-item">
                    <a href="#about" class="nav-link">About</a>
                </li>
                <li class="nav-item">
                    <a href="#projects" class="nav-link">Projects</a>
                </li>
                <li class="nav-item">
                    <a href="#contact" class="nav-link">Contact</a>
                </li>
            </ul>
        </div>
    </nav>

    <!-- Home Section -->
    <section id="home" class="hero">
        <div class="hero-container">
            <div class="hero-content">
                <h1>Hi, I'm <span class="highlight">[Your Name]</span></h1>
                <p class="hero-subtitle">Frontend Developer & UI Designer</p>
                <p class="hero-description">I create beautiful, responsive websites with modern technologies and thoughtful design.</p>
                <div class="hero-btns">
                    <a href="#projects" class="btn btn-primary">View My Work</a>
                    <a href="#contact" class="btn btn-secondary">Contact Me</a>
                </div>
            </div>
        </div>
    </section>

    <!-- About Section -->
    <section id="about" class="about">
        <div class="container">
            <h2 class="section-title">About Me</h2>
            <div class="about-content">
                <div class="about-text">
                    <p>I'm a passionate frontend developer with experience in creating responsive and accessible websites.</p>
                    <p>When I'm not coding, you can find me exploring new technologies or enjoying the outdoors.</p>
                </div>
                <div class="skills">
                    <h3>Skills</h3>
                    <ul class="skills-list">
                        <li>HTML5 & CSS3</li>
                        <li>JavaScript (ES6+)</li>
                        <li>React</li>
                        <li>Responsive Design</li>
                    </ul>
                </div>
            </div>
        </div>
    </section>

    <!-- Projects Section -->
    <section id="projects" class="projects">
        <div class="container">
            <h2 class="section-title">My Projects</h2>
            <div class="projects-grid">
                <div class="project-card">
                    <div class="project-image">
                        <img src="https://via.placeholder.com/400x250" alt="Project 1">
                    </div>
                    <div class="project-info">
                        <h3>Project One</h3>
                        <p>A responsive web application built with modern web technologies.</p>
                        <a href="#" class="project-link">View Project</a>
                    </div>
                </div>
                <div class="project-card">
                    <div class="project-image">
                        <img src="https://via.placeholder.com/400x250" alt="Project 2">
                    </div>
                    <div class="project-info">
                        <h3>Project Two</h3>
                        <p>An e-commerce platform with product management and user authentication.</p>
                        <a href="#" class="project-link">View Project</a>
                    </div>
                </div>
                <div class="project-card">
                    <div class="project-image">
                        <img src="https://via.placeholder.com/400x250" alt="Project 3">
                    </div>
                    <div class="project-info">
                        <h3>Project Three</h3>
                        <p>A mobile-first application with offline capabilities.</p>
                        <a href="#" class="project-link">View Project</a>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Contact Section -->
    <section id="contact" class="contact">
        <div class="container">
            <h2 class="section-title">Get In Touch</h2>
            <div class="contact-form-container">
                <form class="contact-form">
                    <div class="form-group">
                        <label for="name">Name</label>
                        <input type="text" id="name" name="name" required>
                    </div>
                    <div class="form-group">
                        <label for="email">Email</label>
                        <input type="email" id="email" name="email" required>
                    </div>
                    <div class="form-group">
                        <label for="message">Message</label>
                        <textarea id="message" name="message" rows="5" required></textarea>
                    </div>
                    <button type="submit" class="btn btn-primary">Send Message</button>
                </form>
            </div>
        </div>
    </section>

    <!-- Dark Mode Toggle -->
    <button id="dark-mode-toggle" class="dark-mode-toggle">
        <span class="sun-icon">☀️</span>
        <span class="moon-icon">🌙</span>
    </button>

    <script src="script.js"></script>
</body>
</html>`;

    const jsContent = `// Dark mode toggle functionality
const darkModeToggle = document.getElementById('dark-mode-toggle');
const body = document.body;

// Check for saved theme preference or respect OS preference
const currentTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
body.setAttribute('data-theme', currentTheme);

// Toggle dark mode
function toggleDarkMode() {
  const currentTheme = body.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  body.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
}

// Add event listener to dark mode toggle button
darkModeToggle.addEventListener('click', toggleDarkMode);

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    
    const targetId = this.getAttribute('href');
    const targetElement = document.querySelector(targetId);
    
    if (targetElement) {
      window.scrollTo({
        top: targetElement.offsetTop - 70, // Account for fixed header
        behavior: 'smooth'
      });
    }
  });
});

// Form submission handling
document.querySelector('.contact-form').addEventListener('submit', function(e) {
  e.preventDefault();
  alert('Thank you for your message! In a real application, this would be sent to a server.');
  this.reset();
});
`;

    const cssContent = `/* CSS Variables for Light/Dark Theme */
:root {
  --primary-color: #4a6cf7;
  --secondary-color: #6c757d;
  --background-color: #ffffff;
  --text-color: #333333;
  --text-light: #666666;
  --border-color: #e0e0e0;
  --card-bg: #f8f9fa;
  --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  --transition: all 0.3s ease;
}

[data-theme="dark"] {
  --primary-color: #5d7bff;
  --secondary-color: #adb5bd;
  --background-color: #121212;
  --text-color: #f0f0f0;
  --text-light: #cccccc;
  --border-color: #333333;
  --card-bg: #1e1e1e;
  --shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}

/* Base Styles */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: var(--background-color);
  color: var(--text-color);
  line-height: 1.6;
  transition: var(--transition);
}

/* Container */
.container {
  width: 90%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
}

/* Header & Navigation */
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  background-color: var(--background-color);
  box-shadow: var(--shadow);
  transition: var(--transition);
  z-index: 1000;
}

.nav-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
}

.nav-logo a {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--primary-color);
  text-decoration: none;
}

.nav-menu {
  display: flex;
  list-style: none;
}

.nav-item {
  margin-left: 2rem;
}

.nav-link {
  text-decoration: none;
  color: var(--text-color);
  font-weight: 500;
  transition: var(--transition);
}

.nav-link:hover {
  color: var(--primary-color);
}

/* Hero Section */
.hero {
  min-height: 100vh;
  display: flex;
  align-items: center;
  padding-top: 80px;
  background-color: var(--background-color);
  transition: var(--transition);
}

.hero-container {
  width: 90%;
  max-width: 1200px;
  margin: 0 auto;
  text-align: center;
}

.hero-title {
  font-size: 3rem;
  margin-bottom: 1rem;
  color: var(--text-color);
  transition: var(--transition);
}

.highlight {
  color: var(--primary-color);
}

.hero-subtitle {
  font-size: 1.5rem;
  margin-bottom: 1rem;
  color: var(--primary-color);
  font-weight: 600;
}

.hero-description {
  font-size: 1.1rem;
  margin-bottom: 2rem;
  color: var(--text-light);
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

.hero-btns {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 2rem;
}

.btn {
  display: inline-block;
  padding: 12px 30px;
  border-radius: 50px;
  text-decoration: none;
  font-weight: 600;
  transition: var(--transition);
  border: 2px solid transparent;
  cursor: pointer;
}

.btn-primary {
  background-color: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background-color: transparent;
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.btn-secondary {
  background-color: transparent;
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.btn-secondary:hover {
  background-color: var(--primary-color);
  color: white;
}

/* Section Styling */
section {
  padding: 80px 0;
}

.section-title {
  font-size: 2.5rem;
  text-align: center;
  margin-bottom: 3rem;
  color: var(--text-color);
  transition: var(--transition);
}

/* About Section */
.about {
  background-color: var(--background-color);
  transition: var(--transition);
}

.about-content {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 3rem;
}

.about-text {
  color: var(--text-light);
  font-size: 1.1rem;
  line-height: 1.8;
}

.skills {
  background-color: var(--card-bg);
  padding: 2rem;
  border-radius: 10px;
  box-shadow: var(--shadow);
  transition: var(--transition);
}

.skills h3 {
  margin-bottom: 1rem;
  color: var(--primary-color);
}

.skills-list {
  list-style: none;
}

.skills-list li {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
  transition: var(--transition);
}

.skills-list li:last-child {
  border-bottom: none;
}

/* Projects Section */
.projects {
  background-color: var(--card-bg);
  transition: var(--transition);
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
}

.project-card {
  background-color: var(--background-color);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: var(--transition);
}

.project-card:hover {
  transform: translateY(-10px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
}

.project-image img {
  width: 100%;
  height: 200px;
  object-fit: cover;
  transition: var(--transition);
}

.project-card:hover .project-image img {
  transform: scale(1.1);
}

.project-info {
  padding: 1.5rem;
}

.project-info h3 {
  margin-bottom: 0.5rem;
  color: var(--text-color);
}

.project-info p {
  color: var(--text-light);
  margin-bottom: 1rem;
}

.project-link {
  color: var(--primary-color);
  text-decoration: none;
  font-weight: 600;
  transition: var(--transition);
}

.project-link:hover {
  color: var(--secondary-color);
}

/* Contact Section */
.contact {
  background-color: var(--background-color);
  transition: var(--transition);
}

.contact-form-container {
  max-width: 600px;
  margin: 0 auto;
}

.contact-form {
  background-color: var(--card-bg);
  padding: 2rem;
  border-radius: 10px;
  box-shadow: var(--shadow);
  transition: var(--transition);
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  color: var(--text-color);
  font-weight: 500;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background-color: var(--background-color);
  color: var(--text-color);
  font-family: inherit;
  transition: var(--transition);
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--primary-color);
}

/* Dark Mode Toggle Button */
.dark-mode-toggle {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background-color: var(--card-bg);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  box-shadow: var(--shadow);
  transition: var(--transition);
}

.dark-mode-toggle:hover {
  transform: scale(1.1);
  background-color: var(--primary-color);
}

.dark-mode-toggle .sun-icon,
.dark-mode-toggle .moon-icon {
  font-size: 1.5rem;
  transition: var(--transition);
}

.dark-mode-toggle .sun-icon {
  opacity: 1;
}

.dark-mode-toggle .moon-icon {
  opacity: 0;
}

[data-theme="dark"] .dark-mode-toggle .sun-icon {
  opacity: 0;
}

[data-theme="dark"] .dark-mode-toggle .moon-icon {
  opacity: 1;
}

/* Responsive Design */
@media screen and (max-width: 768px) {
  .nav-menu {
    flex-direction: column;
  }
  
  .nav-item {
    margin: 0.5rem 0;
  }
  
  .hero-title {
    font-size: 2.5rem;
  }
  
  .section-title {
    font-size: 2rem;
  }
  
  .about-content {
    grid-template-columns: 1fr;
  }
  
  .hero-btns {
    flex-direction: column;
    align-items: center;
  }
  
  .projects-grid {
    grid-template-columns: 1fr;
  }
}
`;

    fs.writeFileSync(path.join(projectPath, 'index.html'), htmlContent);
    fs.writeFileSync(path.join(projectPath, 'script.js'), jsContent);
    fs.writeFileSync(path.join(projectPath, 'style.css'), cssContent);
    fs.writeFileSync(path.join(projectPath, 'README.md'), `# My Portfolio

A personal portfolio website built with HTML, CSS, and JavaScript featuring a responsive design and dark mode toggle.

## Features

- Responsive design that works on all devices
- Dark/light mode toggle with system preference detection
- Smooth scrolling navigation
- Project showcase section
- Contact form
- Modern UI with CSS transitions and animations

## Technologies Used

- HTML5
- CSS3 (with CSS variables for theming)
- JavaScript (ES6+)

## Installation

1. Clone or download this repository
2. Open index.html in your browser

## Customization

To customize this portfolio for your own use:

1. Update the content in index.html with your information
2. Replace placeholder images with your own
3. Update the styles in style.css to match your preferences
4. Modify the JavaScript in script.js as needed

## Dark Mode

The portfolio includes a dark mode toggle that remembers the user's preference using localStorage. It also respects the system's dark mode preference by default.

## License

This project is open source and available under the [MIT License](LICENSE).
`);
  } else {
    // Create basic HTML file for non-portfolio projects
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Project</title>
    <script src="script.js"></script>
</head>
<body>
    <div id="app">
        <h1>Welcome to Your New Project</h1>
        <p>You can start building your application here.</p>
    </div>
</body>
</html>`;

    const jsContent = `console.log('Hello from your new project!');

// Add your JavaScript code here`;

    const cssContent = `body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 20px;
    line-height: 1.6;
}

#app {
    max-width: 800px;
    margin: 0 auto;
}`;

    fs.writeFileSync(path.join(projectPath, 'index.html'), htmlContent);
    fs.writeFileSync(path.join(projectPath, 'script.js'), jsContent);
    fs.writeFileSync(path.join(projectPath, 'style.css'), cssContent);
    fs.writeFileSync(path.join(projectPath, 'README.md'), `# New Project

This project was generated using Coder CLI.

## Getting Started

This is a simple HTML, CSS, and JavaScript project. To get started:

1. Open index.html in your browser
2. Modify the files to build your application
`);
  }
};

const createNextJSFiles = (projectPath: string) => {
  // Create package.json for Next.js
  const packageJson = {
    name: path.basename(projectPath),
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      lint: 'next lint'
    },
    dependencies: {
      'next': '^14.0.0',
      'react': '^18',
      'react-dom': '^18'
    }
  };

  // Create basic Next.js files
  fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));

  const pagesDir = path.join(projectPath, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  
  const indexContent = `import Head from 'next/head'
import styles from '../styles/Home.module.css'

export default function Home() {
  return (
    <div className={styles.container}>
      <Head>
        <title>Create Next App</title>
      </Head>

      <main className={styles.main}>
        <h1 className={styles.title}>
          Welcome to <a href="https://nextjs.org">Next.js!</a>
        </h1>
      </main>
    </div>
  )
}`;

  fs.writeFileSync(path.join(pagesDir, 'index.js'), indexContent);

  const stylesDir = path.join(projectPath, 'styles');
  fs.mkdirSync(stylesDir, { recursive: true });

  const homeStyles = `.container {
  min-height: 100vh;
  padding: 0 0.5rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.main {
  padding: 5rem 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.title {
  margin: 0;
  line-height: 1.15;
  font-size: 4rem;
}`;

  fs.writeFileSync(path.join(stylesDir, 'Home.module.css'), homeStyles);

  fs.writeFileSync(path.join(projectPath, 'README.md'), `# Next.js Project

This project was generated using Coder CLI.`);
};

const createViteFiles = (projectPath: string) => {
  // Create package.json for Vite
  const packageJson = {
    name: path.basename(projectPath),
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview'
    },
    devDependencies: {
      'vite': '^5.0.0'
    }
  };

  fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create basic Vite files
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/main.js"></script>
  </body>
</html>`;

  const jsContent = `import './style.css'
import { setupCounter } from './counter.js'

document.querySelector('#app').innerHTML = \`
  <div>
    <h1>Vite + JavaScript</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
  </div>
\`

setupCounter(document.querySelector('#counter'))`;

  const cssContent = `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}`;

  const counterContent = `export function setupCounter(element) {
  let counter = 0
  const setCounter = (count) => {
    counter = count
    element.innerHTML = \`count is \${counter}\`
  }
  element.addEventListener('click', () => setCounter(counter + 1))
  setCounter(0)
}`;

  fs.writeFileSync(path.join(projectPath, 'index.html'), htmlContent);
  fs.writeFileSync(path.join(projectPath, 'main.js'), jsContent);
  fs.writeFileSync(path.join(projectPath, 'style.css'), cssContent);
  fs.writeFileSync(path.join(projectPath, 'counter.js'), counterContent);
  fs.writeFileSync(path.join(projectPath, 'README.md'), `# Vite Project

This project was generated using Coder CLI.`);
};

const createReactFiles = (projectPath: string) => {
  // Create package.json for React
  const packageJson = {
    name: path.basename(projectPath),
    version: '0.1.0',
    private: true,
    dependencies: {
      'react': '^18.2.0',
      'react-dom': '^18.2.0',
      'react-scripts': '5.0.1'
    },
    scripts: {
      start: 'react-scripts start',
      build: 'react-scripts build',
      test: 'react-scripts test',
      eject: 'react-scripts eject'
    },
    browserslist: {
      production: [
        '>0.2%',
        'not dead',
        'not op_mini all'
      ],
      development: [
        'last 1 chrome version',
        'last 1 firefox version',
        'last 1 safari version'
      ]
    }
  };

  fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));

  const srcDir = path.join(projectPath, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  const indexContent = `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;

  const appContent = `import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Welcome to React App</h1>
      </header>
    </div>
  );
}

export default App;`;

  const cssContent = `body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}`;

  const appCssContent = `.App {
  text-align: center;
}

.App-logo {
  height: 40vmin;
  pointer-events: none;
}

@media (prefers-reduced-motion: no-preference) {
  .App-logo {
    animation: App-logo-spin infinite 20s linear;
  }
}

.App-header {
  background-color: #282c34;
  padding: 20px;
  color: white;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}`;

  fs.writeFileSync(path.join(srcDir, 'index.js'), indexContent);
  fs.writeFileSync(path.join(srcDir, 'App.js'), appContent);
  fs.writeFileSync(path.join(srcDir, 'index.css'), cssContent);
  fs.writeFileSync(path.join(srcDir, 'App.css'), appCssContent);

  const publicDir = path.join(projectPath, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>React App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

  fs.writeFileSync(path.join(publicDir, 'index.html'), htmlContent);
  fs.writeFileSync(path.join(projectPath, 'README.md'), `# React Project

This project was generated using Coder CLI.`);
};

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