/**
 * Custom error classes for the CLI tool
 */

export class CoderCliError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'CoderCliError';
  }
}

export class ConfigError extends CoderCliError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class ProjectAnalysisError extends CoderCliError {
  constructor(message: string) {
    super(message, 'PROJECT_ANALYSIS_ERROR');
    this.name = 'ProjectAnalysisError';
  }
}

export class GitOperationError extends CoderCliError {
  constructor(message: string) {
    super(message, 'GIT_OPERATION_ERROR');
    this.name = 'GitOperationError';
  }
}

export class AiCommunicationError extends CoderCliError {
  constructor(message: string) {
    super(message, 'AI_COMMUNICATION_ERROR');
    this.name = 'AiCommunicationError';
  }
}

export class CodeModificationError extends CoderCliError {
  constructor(message: string) {
    super(message, 'CODE_MODIFICATION_ERROR');
    this.name = 'CodeModificationError';
  }
}

/**
 * Error handling utility functions
 */

// Function to handle and format errors for user display
export const handleUserError = (error: unknown): string => {
  if (error instanceof CoderCliError) {
    return `Error (${error.code}): ${error.message}`;
  } else if (error instanceof Error) {
    return `Error: ${error.message}`;
  } else {
    return `Unknown error occurred: ${error}`;
  }
};

// Function to log technical details for debugging
export const logTechnicalError = (error: unknown): void => {
  if (error instanceof Error) {
    console.error('Technical error details:');
    console.error(`  Name: ${error.name}`);
    console.error(`  Message: ${error.message}`);
    console.error(`  Stack: ${error.stack}`);
  } else {
    console.error('Unknown error type:', error);
  }
};