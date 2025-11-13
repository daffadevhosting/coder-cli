import ora from 'ora';
import type { Readable } from 'stream';
import chalk from 'chalk';
import { Config } from './config.js';
import { AiCommunicationError } from './errors.js';
import { ProjectAnalysisResult } from './project-analyzer.js';
import { cloneRepository } from './git-handler.js';
import { applyModifications, parseModificationsFromResponse, prepareFileContext, CodeModification } from './code-modifier.js';
import readline from 'readline';
import path from 'path'; // Added import
import fs from 'fs-extra'; // Added import
import inquirer from 'inquirer';

// Import types for chat messages
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Interface for AI response including headers
export interface AiResponse {
  content: string;
  headers: {
    'x-ratelimit-remaining'?: string;
    'x-ratelimit-limit'?: string;
    'x-ratelimit-reset'?: string;
  };
}

// Chat session options
export interface ChatSessionOptions {
  mode?: 'chat' | 'fix' | 'create' | 'explain' | 'script' | 'redesign';
  issueDescription?: string;
  specification?: string;
  explanationRequest?: string;
  scriptName?: string;
  scriptSpecification?: string;
  scriptContext?: string;
  redesignUrl?: string;
}

/**
 * Start an interactive chat session with the AI backend
 * @param config - Configuration for the AI backend
 * @param contextPath - Path to the project or repository to provide context
 * @param enableStreaming - Whether to enable streaming responses
 * @param options - Additional options for the chat session
 */
export const startChatSession = async (
  config: Config, 
  contextPath?: string, 
  enableStreaming: boolean = true,
  options: ChatSessionOptions = {}
): Promise<void> => {
  console.log('Starting AI coding assistant session...');
  
  // Prepare context based on the provided path
  let projectAnalysis: ProjectAnalysisResult | null = null;
  let projectPath: string | null = null;
  
  if (contextPath) {
    console.log(`\nLoading context from: ${contextPath}`);
    
    // Check if it's a URL (repository) or local path
    if (isUrl(contextPath)) {
      // Clone repository
      projectPath = await cloneRepository(contextPath);
      const { analyzeProject } = await import('./project-analyzer');
      projectAnalysis = await analyzeProject(projectPath);
    } else {
      // Analyze local project
      const { analyzeProject } = await import('./project-analyzer');
      projectAnalysis = await analyzeProject(contextPath);
      projectPath = contextPath;
    }
    
    console.log('\nProject Summary:');
    console.log(projectAnalysis.summary);
  }
  
  // Prepare initial context for the AI
  const initialContext = prepareInitialContext(projectAnalysis, options);
  
  // Create messages array with initial context
  const messages: ChatMessage[] = [
    { role: 'system', content: initialContext.systemPrompt },
    ...initialContext.initialMessages
  ];
  
  // If we're in fix or create mode, add the specific prompt
  if (options.mode === 'fix' && options.issueDescription) {
    messages.push({
      role: 'user',
      content: `Please fix this issue in the code: ${options.issueDescription}\n\nProvide the corrected code in your response.`
    });
  } else if (options.mode === 'create' && options.specification) {
    messages.push({
      role: 'user',
      content: `Please create the following feature: ${options.specification}\n\nProvide the new code in your response.`
    });
  } else if (options.mode === 'explain' && options.explanationRequest) {
    messages.push({
      role: 'user',
      content: options.explanationRequest
    });
  } else if (options.mode === 'script' && options.scriptContext && options.scriptName && projectPath) {
    messages.push({
      role: 'user',
      content: options.scriptContext
    });
    // For script mode, we expect a single response which is the script content
    // We will not enter the chat loop, but directly get the response and write to file
    const spinner = ora(`Generating script ${options.scriptName}...`).start();
    try {
      const aiResponse = await getResponseWithRetry(config, messages, options);
      spinner.stop();

      const cleanedResponse = cleanAiScriptResponse(aiResponse.content); // Clean the AI response

      const filePath = path.join(projectPath, options.scriptName);
      await fs.ensureDir(path.dirname(filePath)); // Ensure directory exists
      await fs.writeFile(filePath, cleanedResponse); // Write cleaned response
      console.log(chalk.green(`\nSuccessfully created script: ${filePath}`));
    } catch (error) {
      spinner.stop();
      if (error instanceof AiCommunicationError) {
        console.error(chalk.red(error.message));
      } else {
        console.error(chalk.red('Error generating script:'), error);
      }
    }
    return; // Exit after generating script, no interactive chat
  }
  
  // If not in script mode, proceed with interactive chat loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('\nAI Assistant is ready! Type your message (or "exit" to quit):');
  
  // Main chat loop
  const chatLoop = async (): Promise<void> => {
    try {
      const userInput = await new Promise<string>((resolve) => {
        rl.question(chalk.bold('\nYou: '), resolve);
      });
      
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        console.log('Goodbye!');
        rl.close();
        return;
      }
      
      messages.push({ role: 'user', content: userInput });
      
      const spinner = ora('AI is thinking...').start();
      try {
        let aiResponse: AiResponse;
        let aiResponseContent = '';
        let isFirstChunk = true;
  
        if (enableStreaming) {
          aiResponse = await getStreamedResponse(config, messages, (chunk) => {
            if (isFirstChunk) {
              spinner.succeed('AI responded:');
              isFirstChunk = false;
            }
            const processedChunk = processAssistantOutput(chunk);
            process.stdout.write(processedChunk);
            aiResponseContent += chunk;
          }, options);
          
          if (isFirstChunk) {
            spinner.stop();
          }
          aiResponse.content = aiResponseContent;
  
        } else {
          aiResponse = await getResponseWithRetry(config, messages, options);
          spinner.succeed('AI responded:');
          const processedResponse = processAssistantOutput(aiResponse.content);
          console.log(processedResponse);
        }
        
        messages.push({ role: 'assistant', content: aiResponse.content });
        displayTokenWarnings(aiResponse.headers);
        
        if (projectPath && projectAnalysis) {
          const modifications = parseModificationsFromResponse(aiResponse.content);
          if (modifications.length > 0) {
            console.log(`\nFound ${modifications.length} potential code modifications.`);
            const shouldApply = await askUserConfirmation(rl, `Apply these ${modifications.length} modifications?`);
            if (shouldApply) {
              const result = await applyModifications(projectPath, modifications);
              console.log(`\n${result.message}`);
              if (result.errors && result.errors.length > 0) {
                console.error('Errors during modification:', result.errors.join('\n'));
              }
            }
          }
        }
      } catch (error) {
        spinner.fail('An error occurred.');
        if (error instanceof AiCommunicationError) {
          console.error(chalk.red(`\n[AI Communication Error]\n${error.message}`));
        } else {
          console.error(chalk.red('\nAn unexpected error occurred:'), error);
        }
      }
      
      await chatLoop();

    } catch (loopError) {
      console.error(chalk.red.bold('\nFATAL ERROR IN CHAT LOOP: The application will now exit.'), loopError);
      process.exit(1);
    }
  };  
  // Start the chat loop
  await chatLoop();
};

/**
 * Display warnings related to API token usage.
 * @param headers - Response headers containing rate limit and token info.
 */
const displayTokenWarnings = (headers: AiResponse['headers']) => {
  const remaining = parseInt(headers['x-ratelimit-remaining'] || '0', 10);
  const limit = parseInt(headers['x-ratelimit-limit'] || '0', 10);

  if (isNaN(remaining) || isNaN(limit) || limit === 0) {
    return; // No valid rate limit info
  }

  if (remaining <= 2 && remaining > 0) {
    console.log(chalk.yellow(`\n⚠️ Peringatan: Anda memiliki ${remaining} permintaan tersisa sebelum mencapai batas. Pertimbangkan untuk membeli token.`));
  } else if (remaining === 0) {
    console.log(chalk.red(`\n❌ Peringatan: Anda telah mencapai batas permintaan. Silakan beli token untuk melanjutkan.`));
  }
};

/**
 * Start a re-design session with the AI backend
 * @param config - Configuration for the AI backend
 * @param url - The URL of the web page to re-design
 */
export const startRedesignSession = async (config: Config, url: string): Promise<void> => {
  console.log(chalk.cyan(`\n🚀 Starting AI re-design session for: ${url}`));

  // Show a warning if no API key is configured
  if (!config.apiKey) {
    console.log(chalk.yellow('Warning: No API key configured. Re-design feature may be limited or fail.'));
    console.log(chalk.yellow('Run `coder-cli init` to configure your API key.'));
  }

  const spinner = ora('Sending re-design request to AI...').start();
  try {
    const endpointUrl = buildApiUrl(config.apiUrl, 'redesign');
    
    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeout = config.timeout || 30000; // Default to 30 seconds
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      spinner.stop();
      const errorText = await response.text();
      if (response.status === 401 || response.status === 403) {
        // Check if the error message indicates daily limit exceeded
        if (errorText.includes('Daily free generation limit exceeded')) {
          throw new AiCommunicationError(
            `${errorText}\n\nYou have reached your daily free generation limit. Please purchase tokens to continue using AI services..`
          );
        } else if (errorText.includes('Insufficient tokens')) {
          throw new AiCommunicationError(
            `${errorText}\n\nYour tokens are insufficient. Please purchase more tokens to continue..`
          );
        } else {
          throw new AiCommunicationError(`Authentication failed. API key is missing or invalid.\nPlease check your configuration using 'coder-cli init'\nDetails: ${errorText}`);
        }
      }
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const files = data.files || [];

    spinner.stop();

    if (files.length === 0) {
      console.log(chalk.yellow('AI did not generate any files for re-design.'));
      return;
    }

    console.log(chalk.green(`\n✅ AI generated ${files.length} files for re-design.`));

    const { confirmSave } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmSave',
        message: 'Do you want to save these re-designed files to a local directory?',
        default: true,
      }
    ]);

    if (confirmSave) {
      const { targetDirectory } = await inquirer.prompt([
        {
          type: 'input',
          name: 'targetDirectory',
          message: 'Enter the target directory to save the files (e.g., "redesigned-page"):',
          default: 'redesigned-page',
          validate: (input) => input.trim() !== '' || 'Directory name cannot be empty.',
        }
      ]);

      const fullTargetPath = path.resolve(process.cwd(), targetDirectory);

      // Check if directory exists and ask for overwrite
      if (await fs.pathExists(fullTargetPath)) {
        const { overwrite } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'overwrite',
            message: `Directory "${targetDirectory}" already exists. Overwrite its contents?`,
            default: false,
          }
        ]);

        if (!overwrite) {
          console.log(chalk.yellow('File saving cancelled.'));
          return;
        }
        await fs.emptyDir(fullTargetPath); // Clear directory if overwriting
      } else {
        await fs.mkdirp(fullTargetPath); // Create directory if it doesn't exist
      }

      for (const file of files) {
        const filePath = path.join(fullTargetPath, file.path);
        const dirPath = path.dirname(filePath);
        
        await fs.ensureDir(dirPath); // Ensure directory exists
        await fs.writeFile(filePath, file.content);
        console.log(chalk.green(`  Saved: ${filePath}`));
      }

      console.log(chalk.green(`\nSuccessfully saved re-designed files to: ${fullTargetPath}`));
      console.log(chalk.blue('You can now open these files in your browser or editor to review the re-design.'));
    } else {
      console.log(chalk.yellow('File saving skipped.'));
    }

  } catch (error) {
    spinner.stop();
    if (error instanceof AiCommunicationError) {
      console.error(chalk.red(error.message));
    } else {
      console.error(chalk.red('Error during re-design session:'), error);
    }
    process.exit(1);
  }
};

/**
 * Ask user for confirmation with a question
 * @param rl - The readline interface to use
 * @param question - The question to ask
 * @returns User's answer (true for yes, false for no)
 */
const askUserConfirmation = async (rl: readline.Interface, question: string): Promise<boolean> => {
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} (y/N): `, resolve);
  });
  
  return ['y', 'yes', 'Y', 'YES'].includes(answer.trim());
};

/**
 * Cleans the AI's script generation response by removing thinking blocks and extracting code from markdown.
 * @param rawResponse - The raw string response from the AI.
 * @returns The cleaned script content.
 */
const cleanAiScriptResponse = (rawResponse: string): string => {
  let cleaned = rawResponse;

  // 1. Remove <think>...</think> blocks
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // 2. Extract code from markdown blocks (e.g., ```javascript\n...\n```)
  const markdownMatch = cleaned.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
  if (markdownMatch && markdownMatch[1]) {
    cleaned = markdownMatch[1].trim();
  }

  return cleaned;
};

/**
 * Get streamed response from the AI backend
 * @param config - Configuration for the AI backend
 * @param messages - Conversation messages
 * @param onChunk - Callback function to handle response chunks
 * @param options - Chat session options
 */
const getStreamedResponse = async (
  config: Config,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  options: ChatSessionOptions = {}
): Promise<AiResponse> => {
  let aiResponseContent = '';
  const responseHeaders: AiResponse['headers'] = {};

  try {
    // Construct the appropriate endpoint URL based on mode
    const endpointUrl = buildApiUrl(config.apiUrl, options.mode || 'chat');

    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeout = config.timeout || 30000; // Default to 30 seconds
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    } else {
      console.log(chalk.yellow('Warning: API key not found. Run `coder-cli init` to configure it.'));
    }

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        messages,
        mode: options.mode || 'chat'
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    
    // Extract rate limit headers
    responseHeaders['x-ratelimit-remaining'] = response.headers.get('x-ratelimit-remaining') || undefined;
    responseHeaders['x-ratelimit-limit'] = response.headers.get('x-ratelimit-limit') || undefined;
    responseHeaders['x-ratelimit-reset'] = response.headers.get('x-ratelimit-reset') || undefined;

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API request failed with status ${response.status}: ${errorText}`;
      try {
        // Try to parse the error response as JSON
        const errorData = JSON.parse(errorText);
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // Not a JSON error, use the raw text. The backend might send plain text errors.
      }
      // The backend now sends user-friendly messages, so we can throw them directly.
      throw new AiCommunicationError(errorMessage);
    }
    
    // Check if the response is actually a streaming response
    if (response.headers.get('content-type')?.includes('text/event-stream') || 
        response.headers.get('content-type')?.includes('text/plain')) {
      // Handle streaming response - type assertion to bypass node-fetch type issues
      const body: any = response.body;
      if (!body) {
        // If no body, fall back to reading the entire response
        const text = await response.text();
        onChunk(text);
        aiResponseContent += text;
        return { content: aiResponseContent, headers: responseHeaders };
      }
      
      const reader = body.getReader ? body.getReader() : null;
      if (!reader) {
        // If no reader, fall back to reading the entire response
        const text = await response.text();
        onChunk(text);
        aiResponseContent += text;
        return { content: aiResponseContent, headers: responseHeaders };
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            // Process any remaining buffer
            if (buffer.trim()) {
              // Check if the remaining buffer has a 'data: ' prefix
              if (buffer.startsWith('data: ')) {
                const chunk = buffer.substring(6); // Remove 'data: ' prefix
                onChunk(chunk);
                aiResponseContent += chunk;
              } else {
                onChunk(buffer);
                aiResponseContent += buffer;
              }
            }
            break;
          }
          
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete lines in the buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep the incomplete line in buffer
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                // Handle SSE format (data: ...)
                if (line.startsWith('data: ')) {
                  const dataStr = line.substring(6); // Remove 'data: ' prefix
                  
                  if (dataStr === '[DONE]') {
                    break;
                  }
                  
                  const parsed: { [key: string]: any } = JSON.parse(dataStr);
                  
                  if (parsed.response) {
                    onChunk(parsed.response);
                    aiResponseContent += parsed.response;
                  }
                } else {
                  // Handle regular JSON responses
                  const parsed: { [key: string]: any } = JSON.parse(line);
                  
                  if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                    const content = parsed.choices[0].delta.content;
                    if (content) {
                      onChunk(content);
                      aiResponseContent += content;
                    }
                  } else if (parsed.response) {
                    onChunk(parsed.response);
                    aiResponseContent += parsed.response;
                  }
                }
              } catch (e) {
                // If JSON parsing fails, treat as plain text
                // But first remove 'data: ' prefix if present
                if (line.startsWith('data: ')) {
                  const chunk = line.substring(6); // Remove 'data: ' prefix
                  onChunk(chunk);
                  aiResponseContent += chunk;
                } else {
                  onChunk(line);
                  aiResponseContent += line;
                }
              }
            }
          }
        }
      } finally {
        if (reader.releaseLock) {
          reader.releaseLock();
        }
      }
    } else {
      // For non-streaming responses, just read as text
      const text = await response.text();
      onChunk(text);
      aiResponseContent += text;
    }
    return { content: aiResponseContent, headers: responseHeaders };
  } catch (error) {
    // If streaming fails, try a non-streaming fallback.
    // Don't log here, let the caller handle UI.
    try {
      const fallbackResult = await getResponseWithRetry(config, messages, options);
      onChunk(fallbackResult.content);
      return fallbackResult;
    } catch (fallbackError) {
      // If fallback also fails, throw the most specific error.
      if (fallbackError instanceof AiCommunicationError) {
        throw fallbackError;
      }
      if (error instanceof AiCommunicationError) {
        throw error;
      }
      // For generic errors, throw the fallback error if it exists, otherwise the original.
      throw fallbackError || error;
    }
  }
};

/**
 * Get non-streamed response from the AI backend
 * @param config - Configuration for the AI backend
 * @param messages - Conversation messages
 * @returns AI response
 */
const getResponse = async (config: Config, messages: ChatMessage[], options: ChatSessionOptions = {}): Promise<AiResponse> => {
  const responseHeaders: AiResponse['headers'] = {};
  let aiResponseContent = '';

  try {
    // Construct the appropriate endpoint URL based on mode
    const endpointUrl = buildApiUrl(config.apiUrl, options.mode || 'chat');

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    } else {
      console.log(chalk.yellow('Warning: API key not found. Run `coder-cli init` to configure it.'));
    }

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        messages,
        mode: options.mode || 'chat'
      })
    });
    
    // Extract rate limit headers
    responseHeaders['x-ratelimit-remaining'] = response.headers.get('x-ratelimit-remaining') || undefined;
    responseHeaders['x-ratelimit-limit'] = response.headers.get('x-ratelimit-limit') || undefined;
    responseHeaders['x-ratelimit-reset'] = response.headers.get('x-ratelimit-reset') || undefined;

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API request failed with status ${response.status}: ${errorText}`;
      try {
        // Try to parse the error response as JSON
        const errorData = JSON.parse(errorText);
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // Not a JSON error, use the raw text. The backend might send plain text errors.
      }
      // The backend now sends user-friendly messages, so we can throw them directly.
      throw new AiCommunicationError(errorMessage);
    }
    
    // Check if response is JSON or plain text
    const contentType = response.headers.get('content-type');
    let data: { [key: string]: any } = {};
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json() as { [key: string]: any };
    } else {
      // For non-JSON responses, treat as plain text
      const text = await response.text();
      try {
        data = JSON.parse(text) as { [key: string]: any };
      } catch {
        // If it's not valid JSON, return as is
        aiResponseContent = text;
        return { content: aiResponseContent, headers: responseHeaders };
      }
    }
    
    // Handle different response formats
    if (data.choices && data.choices[0]) {
      aiResponseContent = data.choices[0].message?.content || data.choices[0].delta?.content || '';
    } else if (data.response) {
      aiResponseContent = data.response;
    } else if (typeof data === 'string') {
      aiResponseContent = data;
    } else {
      aiResponseContent = JSON.stringify(data);
    }
    return { content: aiResponseContent, headers: responseHeaders };
  } catch (error) {
    // Let the caller handle the error UI
    throw error;
  }
};

/**
 * Wrapper for getResponse with retry mechanism to handle connection failures
 * @param config - Configuration for the AI backend
 * @param messages - Chat messages to send
 * @param options - Additional options for the chat session
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Promise resolving to the AI response
 */
const getResponseWithRetry = async (
  config: Config,
  messages: ChatMessage[],
  options: ChatSessionOptions = {},
  maxRetries: number = 3
): Promise<AiResponse> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await getResponse(config, messages, options);
    } catch (error) {
      lastError = error;

      // Check if error is a timeout or connection issue that should not be retried
      if (error instanceof Error) {
        if (error.message.includes('Daily free generation limit exceeded') || 
            error.message.includes('Insufficient tokens') ||
            error.message.includes('Authentication failed')) {
          // These are not retryable errors
          throw error;
        }
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s...
        console.log(chalk.yellow(`Request failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay/1000}s...`));
        
        // Wait for the delay period
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // If all retries failed, throw the last error
  throw lastError || new Error('Request failed after maximum retries');
};

/**
 * Prepare initial context for the AI conversation
 * @param projectAnalysis - Analysis of the project (if available)
 * @param options - Chat session options
 * @returns Initial context with system prompt and initial messages
 */
const prepareInitialContext = (
  projectAnalysis: ProjectAnalysisResult | null,
  options: ChatSessionOptions
): { systemPrompt: string; initialMessages: ChatMessage[] } => {
  let systemPrompt = `You are an AI coding assistant. Help with analyzing, creating, and fixing code.
  
Be concise but thorough in your responses. When providing code, use proper syntax highlighting.
If you're asked to analyze a project, focus on the architecture, key components, and potential issues.
If you're asked to fix code, identify the issue and provide corrected code with explanations.
If you're asked to create code, implement the requested functionality following best practices.`;
  
  const initialMessages: ChatMessage[] = [];
  
  if (projectAnalysis) {
    // Add project information to the context
    initialMessages.push({
      role: 'user',
      content: `I'm working on a project with the following structure:\n\n${projectAnalysis.summary}\n\nHere are some key files:`
    });
    
    // Add content of configuration files
    for (const configFile of projectAnalysis.configFiles) {
      if (configFile.content.length < 2000) { // Only include short config files
        initialMessages.push({
          role: 'user',
          content: `File: ${configFile.relativePath}\n\n${configFile.content}`
        });
      }
    }
    
    // Mention the existence of other code files without including them all
    if (projectAnalysis.codeFiles.length > 0) {
      initialMessages.push({
        role: 'user',
        content: `The project contains ${projectAnalysis.codeFiles.length} code files. I can provide specific files if needed.`
      });
    }
  }
  
  // Adjust system prompt based on mode
  if (options.mode === 'fix') {
    systemPrompt += `\n\nThe user wants to fix an issue: ${options.issueDescription || 'Unknown issue'}`;
  } else if (options.mode === 'create') {
    systemPrompt += `\n\nThe user wants to create: ${options.specification || 'Something unspecified'}`;
  } else if (options.mode === 'explain') {
    systemPrompt += `\n\nThe user wants an explanation for the following code: ${options.explanationRequest || 'a piece of code'}`;
  } else if (options.mode === 'script') {
    systemPrompt += `\n\nThe user wants to generate a script file named "${options.scriptName || 'unknown.js'}" with the following specification: "${options.scriptSpecification || 'unspecified functionality'}". Analyze the provided project context and generate the script content. Output ONLY the script content, no additional text or markdown.`;
  }
  
  return { systemPrompt, initialMessages };
};

/**
 * Check if a string is a URL
 * @param str - String to check
 * @returns True if the string is a URL, false otherwise
 */
const isUrl = (str: string): boolean => {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
};

/**
 * Process assistant output to distinguish between reasoning and actual responses
 * @param output - Raw output from the assistant
 * @returns Processed output with color coding
 */
const processAssistantOutput = (output: string): string => {
  // Clean up SSE markers and other artifacts from the raw output
  let cleanedOutput = output;
  
  // Remove SSE markers like 'data: {"response":"..."}' and '[DONE]' markers
  cleanedOutput = cleanedOutput
    .replace(/data: \{"response":"([^"]|\\")*"\}/g, (match) => {
      // Extract the content from the response field
      try {
        const parsed = JSON.parse(match.substring(6)); // Remove "data: " prefix
        return parsed.response || '';
      } catch {
        return match; // Return original if parsing fails
      }
    })
    .replace(/\[DONE\]/g, '') // Remove [DONE] markers
    .replace(/\\n/g, '\n'); // Convert escaped newlines

  // We'll split the cleaned output by lines and color-code based on patterns
  const lines = cleanedOutput.split('\n');
  const processedLines: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      // Keep empty lines as they are
      processedLines.push(line);
      continue;
    }

    // Check if this line is likely reasoning (contains thinking patterns)
    const isReasoning = line.includes('I need to') || 
                       line.includes('Let me') || 
                       line.includes('I remember') || 
                       line.includes('I should') || 
                       line.includes('I think') || 
                       line.includes('Okay, so') ||
                       line.includes('Another thing') ||
                       line.includes('What about') ||
                       line.includes('Wait,') ||
                       line.includes('In summary') ||
                       line.includes('First, I') ||
                       line.includes('So, I') ||
                       line.includes('I was thinking') ||
                       line.startsWith('[') && line.endsWith(']'); // Common bracket notation for internal thoughts

    if (isReasoning) {
      // Apply the specific hex color #0E4B4D for reasoning
      processedLines.push(chalk.gray(line));
    } else {
      // Apply normal/bright color for actual response
      processedLines.push(chalk.greenBright(line));
    }
  }

  return processedLines.join('\n');
};

/**
 * Helper function to build the proper API URL based on operation mode
 * @param baseUrl - Base API URL (e.g., https://coder-ai.mvstream.workers.dev/api)
 * @param mode - Operation mode ('chat', 'create', 'fix', 'project', 'analyze')
 * @returns Full API endpoint URL
 */
export const buildApiUrl = (baseUrl: string, mode: string): string => {
  // Ensure baseUrl ends with /api to form proper endpoint URLs
  let normalizedBaseUrl = baseUrl;
  
  // If baseUrl doesn't end with /api, append it
  if (!normalizedBaseUrl.endsWith('/api')) {
    if (normalizedBaseUrl.endsWith('/api/chat') || normalizedBaseUrl.endsWith('/api/create') || 
        normalizedBaseUrl.endsWith('/api/fix') || normalizedBaseUrl.endsWith('/api/project')) {
      // If it already has a specific endpoint, remove the endpoint part to get base
      normalizedBaseUrl = normalizedBaseUrl.substring(0, normalizedBaseUrl.lastIndexOf('/'));
    } else {
      // If it's just the base domain, append /api
      if (!normalizedBaseUrl.endsWith('/api')) {
        normalizedBaseUrl = normalizedBaseUrl.replace(/\/$/, '') + '/api';
      }
    }
  }
  
  // Remove trailing slash if present
  normalizedBaseUrl = normalizedBaseUrl.replace(/\/$/, '');
  
  switch (mode) {
    case 'create':
      return `${normalizedBaseUrl}/create`;
    case 'fix':
      return `${normalizedBaseUrl}/fix`;
    case 'project':
      return `${normalizedBaseUrl}/project`;
    case 'analyze':
      return `${normalizedBaseUrl}/analyze`;
    case 'explain':
      return `${normalizedBaseUrl}/explain`;
    case 'script':
      return `${normalizedBaseUrl}/script`;
    case 'redesign':
      return `${normalizedBaseUrl}/redesign`;
    default:
      return `${normalizedBaseUrl}/chat`;
  }
};