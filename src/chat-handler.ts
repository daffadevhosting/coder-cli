import fetch from 'node-fetch';
import type { Readable } from 'stream';
import chalk from 'chalk';
import { Config } from './config.js';
import { AiCommunicationError } from './errors.js';
import { ProjectAnalysisResult } from './project-analyzer.js';
import { cloneRepository } from './git-handler.js';
import { applyModifications, parseModificationsFromResponse, prepareFileContext, CodeModification } from './code-modifier.js';
import readline from 'readline';

// Import types for chat messages
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Chat session options
export interface ChatSessionOptions {
  mode?: 'chat' | 'fix' | 'create';
  issueDescription?: string;
  specification?: string;
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
  }
  
  // Set up readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('\nAI Assistant is ready! Type your message (or "exit" to quit):');
  
  // Main chat loop
  const chatLoop = async (): Promise<void> => {
    const userInput = await new Promise<string>((resolve) => {
      rl.question('\nYou: ', resolve);
    });
    
    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('Goodbye!');
      rl.close();
      return;
    }
    
    // Add user message to conversation
    messages.push({ role: 'user', content: userInput });
    
    // Get AI response
    try {
      console.log('\nAssistant: ');
      
      let aiResponse = '';
      let isFirstChunk = true;
      
      // Show "Thinking..." message
      process.stdout.write(chalk.gray('Thinking...'));

      if (enableStreaming) {
        await getStreamedResponse(config, messages, (chunk) => {
          if (isFirstChunk) {
            // Clear the "Thinking..." line on first chunk
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            isFirstChunk = false;
          }
          const processedChunk = processAssistantOutput(chunk);
          process.stdout.write(processedChunk);
          aiResponse += chunk;
        }, options);
        
        // If no chunks were received, clear the "Thinking..." message
        if (isFirstChunk) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
        }

      } else {
        aiResponse = await getResponse(config, messages, options);
        // Clear the "Thinking..." line
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        
        const processedResponse = processAssistantOutput(aiResponse);
        console.log(processedResponse);
        messages.push({ role: 'assistant', content: aiResponse });
      }
      
      // Check if the response contains code modifications that should be applied
      if (projectPath && projectAnalysis) {
        const modifications = parseModificationsFromResponse(aiResponse);
        if (modifications.length > 0) {
          console.log(`\nFound ${modifications.length} potential code modifications in the response.`);
          
          // Ask user if they want to apply the modifications
          const shouldApply = await askUserConfirmation(`Apply these ${modifications.length} code modifications?`);
          if (shouldApply) {
            const result = await applyModifications(projectPath, modifications);
            console.log(`\nModification result: ${result.message}`);
            
            if (result.errors && result.errors.length > 0) {
              console.error('Errors during modification:', result.errors.join('\n'));
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof AiCommunicationError) {
        console.error(chalk.red(error.message));
      } else {
        console.error(chalk.red('Error getting AI response:'), error);
      }
    }
    
    // Continue the chat loop
    await chatLoop();
  };
  
  // Start the chat loop
  await chatLoop();
};

/**
 * Ask user for confirmation with a question
 * @param question - The question to ask
 * @returns User's answer (true for yes, false for no)
 */
const askUserConfirmation = async (question: string): Promise<boolean> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} (y/N): `, resolve);
  });
  
  rl.close();
  
  return ['y', 'yes', 'Y', 'YES'].includes(answer.trim());
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
): Promise<void> => {
  try {
    // Construct the appropriate endpoint URL based on mode
    const endpointUrl = buildApiUrl(config.apiUrl, options.mode || 'chat');

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({ 
        messages,
        mode: options.mode || 'chat'
      })
    });
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AiCommunicationError(`Authentication failed. API key is missing or invalid.\nPlease check your configuration using 'coder-cli init'`);
      }
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
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
        return;
      }
      
      const reader = body.getReader ? body.getReader() : null;
      if (!reader) {
        // If no reader, fall back to reading the entire response
        const text = await response.text();
        onChunk(text);
        return;
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            // Process any remaining buffer
            if (buffer.trim()) {
              onChunk(buffer);
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
                  }
                } else {
                  // Handle regular JSON responses
                  const parsed: { [key: string]: any } = JSON.parse(line);
                  
                  if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                    const content = parsed.choices[0].delta.content;
                    if (content) {
                      onChunk(content);
                    }
                  } else if (parsed.response) {
                    onChunk(parsed.response);
                  }
                }
              } catch (e) {
                // If JSON parsing fails, treat as plain text
                onChunk(line);
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
    }
  } catch (error) {
    // If streaming fails, try a non-streaming fallback.
    // Don't log here, let the caller handle UI.
    try {
      const fallbackResponse = await getResponse(config, messages, options);
      onChunk(fallbackResponse);
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
const getResponse = async (config: Config, messages: ChatMessage[], options: ChatSessionOptions = {}): Promise<string> => {
  try {
    // Construct the appropriate endpoint URL based on mode
    const endpointUrl = buildApiUrl(config.apiUrl, options.mode || 'chat');

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({ 
        messages,
        mode: options.mode || 'chat'
      })
    });
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AiCommunicationError(`Authentication failed. API key is missing or invalid.\nPlease check your configuration using 'coder-cli init'`);
      }
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
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
        return text;
      }
    }
    
    // Handle different response formats
    if (data.choices && data.choices[0]) {
      return data.choices[0].message?.content || data.choices[0].delta?.content || '';
    } else if (data.response) {
      return data.response;
    } else if (typeof data === 'string') {
      return data;
    } else {
      return JSON.stringify(data);
    }
  } catch (error) {
    // Let the caller handle the error UI
    throw error;
  }
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
 * @param baseUrl - Base API URL (e.g., https://coder-ai.mvstream.workers.dev)
 * @param mode - Operation mode ('chat', 'create', 'fix')
 * @returns Full API endpoint URL
 */
const buildApiUrl = (baseUrl: string, mode: string): string => {
  // Ensure baseUrl doesn't end with trailing slash
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  
  switch (mode) {
    case 'create':
      return `${normalizedBaseUrl}/api/create`;
    case 'fix':
      return `${normalizedBaseUrl}/api/fix`;
    default:
      return `${normalizedBaseUrl}/api/chat`;
  }
};