# Coder CLI

[![npm version](https://img.shields.io/npm/v/@jekyll-studio/coder-cli.svg)](https://www.npmjs.com/package/@jekyll-studio/coder-cli) 
[![NPM Weekly Downloads](https://img.shields.io/npm/dw/@jekyll-studio/coder-cli.svg)](https://www.npmjs.com/package/@jekyll-studio/coder-cli)


AI-powered CLI tool for code analysis, creation, and fixes. This tool integrates with your AI backend to provide intelligent coding assistance right from your terminal.

```
__      ___  _____  ____  ____  ____ 
\ \    / __)(  _  )(  _ \( ___)(  _ \
 ) )  ( (__  )(_)(  )(_) ))__)  )   /
/_/    \___)(_____)(____/(____)(_)\_)

```
![coder](./coder.png))
## Installation

Install the CLI globally from npm to use the `coder-cli` command anywhere on your system.

```bash
npm install -g @jekyll-studio/coder-cli
```

> **Note:** This makes two commands available: `coder-cli` (the primary command) and `coder` (a shorter alias). The `coder` alias might not be available if another program on your system is already using it. This documentation will use `coder-cli` in all examples for consistency.

## Configuration

Before using the CLI for the first time, you need to configure it with your AI backend API key.

```bash
coder-cli init
```

This will launch an interactive setup wizard that will ask for your API key and save it in a local configuration file (`~/.coder-cli-config.json`).

## Usage

Here are the main commands available:

### `init`
Initializes or re-configures the CLI tool.

```bash
coder-cli init
```

### `chat`
Starts an interactive chat session. You can provide a local project or a remote Git repository as context for the AI.

```bash
# Start a chat session in the current directory
coder-cli chat

# Use a specific local project as context
coder-cli chat --project /path/to/your/project

# Use a remote public Git repository as context
coder-cli chat --repo https://github.com/user/repo.git

# Start a chat session without streaming responses
coder-cli chat --no-stream
```

### `redesign`
Redesigns a web page from a given URL into new HTML, CSS, and JavaScript files.

```bash
# Redesign a web page from a URL
coder-cli redesign https://www.example.com
```

### `explain`
Gets an AI explanation for a piece of code from a specified file, optionally focusing on a specific line.

```bash
# Explain the entire content of a file
coder-cli explain src/utils/helper.ts

# Explain a specific line in a file
coder-cli explain src/components/Button.tsx --line 25
```

### `analyze`
Performs a high-level analysis of a project, identifying its structure, main technologies, and potential areas for improvement.

```bash
# Analyze the project in the current directory with default text output
coder-cli analyze

# Analyze a specific project path and output in JSON format
coder-cli analyze /path/to/your/project -o json
```

### `fix`
Starts a chat session in "fix" mode to help you resolve a specific issue.

```bash
# Fix an issue in the current project directory
coder-cli fix --issue "The login button is not working on the main page."

# Fix an issue in a specific project path
coder-cli fix /path/to/your/project --issue "There is a null pointer exception in the user service."
```

### `create`
Starts a chat session in "create" mode to generate new code based on a specification.

```bash
# Create new code in the current project directory
coder-cli create --spec "Create a REST API endpoint for user registration."

# Create new code in a specific project path
coder-cli create /path/to/your/project --spec "Add a React component for a contact form."
```

### `create-script`
Generates a new script file based on a given specification and project context.

```bash
# Generate an analytics.js script in the current directory
coder-cli create-script analytics.js -s "a JavaScript file to track page views and user interactions"

# Generate a utility script in a specific project path
coder-cli create-script /path/to/your/project/utils/data-fetcher.js -s "a script to fetch data from an external API"
```

### `new`
Creates a new project with a specified technology stack and features.

```bash
# Create a new project with default vanilla web stack
coder-cli new my-project

# Create a Next.js project
coder-cli new my-next-app -t nextjs

# Create a Vite project with specific features
coder-cli new my-vite-app -t vite -s "with TypeScript and Tailwind CSS"

# Create a React project
coder-cli new my-react-app -t react

# Create a project with custom specifications
coder-cli new my-portfolio -t vanilla -s "with HTML, CSS, and JavaScript for a personal portfolio with dark mode"
```

The `new` command intelligently generates complete project structures with all necessary files, configurations, and dependencies based on the chosen technology stack. It supports multiple stacks including Next.js, Vite, React, and vanilla HTML/CSS/JavaScript projects.


## AI Models Configuration

The backend uses Cloudflare Workers AI to run different AI models for different purposes, optimized for performance and cost.

### Chat Model
- **Model ID**: `@cf/google/gemma-3-12b-it`
- **Purpose**: General conversation, answering questions, and non-code related queries. Ideal for quick, interactive responses.
- **Usage**: Primarily used for `/api/chat` when the mode is 'chat' or unspecified.
- **Characteristics**: Optimized for natural conversation and general knowledge queries. Generally the most cost-effective for basic interactions.

### Code Model  
- **Model ID**: `@cf/qwen/qwen2.5-coder-32b-instruct`
- **Purpose**: Code generation, code fixing, and script generation.
- **Usage**: Used for `/api/create`, `/api/fix`, and `/api/script` endpoints. Also used in `/api/chat` when the mode is 'create' or 'fix'.
- **Characteristics**: Optimized for code understanding, generation, and technical problem solving. Offers a good balance of capability and cost for coding tasks.

### Advanced Model
- **Model ID**: `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`
- **Purpose**: Complex code analysis, detailed explanations, project generation, and creative web page redesign.
- **Usage**: Used for `/api/analyze`, `/api/explain`, `/api/project`, and `/api/redesign` endpoints. Also used in `/api/chat` when the mode is 'analyze'.
- **Characteristics**: A larger, more capable model suitable for tasks requiring deeper understanding, creativity, and comprehensive output. This model is generally more expensive per token.
---
