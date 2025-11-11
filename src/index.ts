#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { analyzeProject } from './project-analyzer';
import { cloneRepository } from './git-handler';
import { startChatSession, ChatMessage } from './chat-handler';
import { loadConfig, Config } from './config';
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
    throw new Error(`Directory ${projectPath} already exists!`);
  }

  fs.mkdirSync(projectPath, { recursive: true });
  console.log(`Created directory: ${projectPath}`);

  // Generate project using AI
  const projectSpec = `Create a new ${technology ? technology : 'web'} project named ${projectName}. ${specification ? specification : 'Include basic structure and functionality.'} Provide all necessary files, code, and configuration.`;

  const messages: ChatMessage[] = [
    { 
      role: 'system', 
      content: 'You are a helpful AI coding assistant that generates complete project files. Return the files in a structured JSON format with file paths and content. Format: {"files": [{"path": "file/path", "content": "file content"}]}' 
    },
    { 
      role: 'user', 
      content: projectSpec 
    }
  ];

  // Call the new project generation endpoint
  const response = await fetch(`${config.apiUrl}/api/project`, {
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
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const files = data.files || [];

  if (files.length === 0) {
    console.log('No files generated by AI. Creating basic structure...');
    // Create basic structure if AI doesn't return files
    createBasicStructure(projectPath, technology);
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
};

const createBasicStructure = (projectPath: string, technology?: string) => {
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
      createVanillaFiles(projectPath);
      break;
  }
};

const createVanillaFiles = (projectPath: string) => {
  // Create basic HTML file
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
    </div>
</body>
</html>`;

  const jsContent = `console.log('Hello from your new project!');

// Add your JavaScript code here`;

  const cssContent = `body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 20px;
}`;

  fs.writeFileSync(path.join(projectPath, 'index.html'), htmlContent);
  fs.writeFileSync(path.join(projectPath, 'script.js'), jsContent);
  fs.writeFileSync(path.join(projectPath, 'style.css'), cssContent);
  fs.writeFileSync(path.join(projectPath, 'README.md'), `# New Project

This project was generated using Coder CLI.`);
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