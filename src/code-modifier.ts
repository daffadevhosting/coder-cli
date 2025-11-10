import fs from 'fs-extra';
import path from 'path';
import { ProjectAnalysisResult } from './project-analyzer';

/**
 * Represents the result of a code modification operation
 */
export interface ModificationResult {
  success: boolean;
  message: string;
  modifiedFiles?: string[];
  errors?: string[];
}

/**
 * Apply code modifications to a project
 * @param projectPath - Path to the project
 * @param modifications - List of modifications to apply
 * @returns Result of the modification operation
 */
export const applyModifications = async (
  projectPath: string, 
  modifications: CodeModification[]
): Promise<ModificationResult> => {
  const result: ModificationResult = {
    success: true,
    message: '',
    modifiedFiles: [],
    errors: []
  };
  
  for (const modification of modifications) {
    try {
      // Validate the modification
      validateModification(modification);
      
      const filePath = path.join(projectPath, modification.filePath);
      
      // Ensure the directory exists
      const dirPath = path.dirname(filePath);
      await fs.ensureDir(dirPath);
      
      // Apply the modification based on the type
      switch (modification.type) {
        case 'create':
          await createFile(filePath, modification.content!); // Safe to use ! because we validated
          result.modifiedFiles?.push(modification.filePath);
          break;
          
        case 'update':
          await updateFile(filePath, modification.content, modification.method);
          result.modifiedFiles?.push(modification.filePath);
          break;
          
        case 'delete':
          await deleteFile(filePath);
          result.modifiedFiles?.push(modification.filePath);
          break;
          
        default:
          result.errors?.push(`Unknown modification type: ${(modification as any).type}`);
          result.success = false;
      }
    } catch (error) {
      const errorMsg = `Error modifying ${modification.filePath}: ${(error as Error).message}`;
      result.errors?.push(errorMsg);
      result.success = false;
      console.error(errorMsg);
    }
  }
  
  if (result.success) {
    result.message = `Successfully modified ${result.modifiedFiles?.length || 0} file(s)`;
  } else {
    result.message = `Partially completed: ${result.errors?.length || 0} error(s) occurred`;
  }
  
  return result;
};

/**
 * Create a new file with the given content
 * @param filePath - Path of the file to create
 * @param content - Content to write to the file
 */
const createFile = async (filePath: string, content: string): Promise<void> => {
  await fs.writeFile(filePath, content, 'utf8');
  console.log(`Created file: ${filePath}`);
};

/**
 * Update an existing file with new content
 * @param filePath - Path of the file to update
 * @param newContent - New content to apply (optional, defaults to empty string)
 * @param method - How to apply the content (replace, append, prepend)
 */
const updateFile = async (filePath: string, newContent: string | undefined, method: ModificationMethod = 'replace'): Promise<void> => {
  let currentContent = '';
  
  // Read the current file content if it exists
  if (await fs.pathExists(filePath)) {
    currentContent = await fs.readFile(filePath, 'utf8');
  }
  
  // If newContent is undefined, use empty string
  const safeNewContent = newContent || '';
  
  let updatedContent = '';
  
  switch (method) {
    case 'replace':
      updatedContent = safeNewContent;
      break;
    case 'append':
      updatedContent = currentContent + safeNewContent;
      break;
    case 'prepend':
      updatedContent = safeNewContent + currentContent;
      break;
    case 'merge':
      updatedContent = mergeCode(currentContent, safeNewContent);
      break;
    default:
      updatedContent = currentContent; // Default to no change
  }
  
  await fs.writeFile(filePath, updatedContent, 'utf8');
  console.log(`Updated file: ${filePath} (method: ${method})`);
};

/**
 * Check if the required arguments are provided for each modification type
 */
const validateModification = (modification: CodeModification): void => {
  if (modification.type === 'create' && modification.content === undefined) {
    throw new Error(`Content is required for 'create' modification type in file: ${modification.filePath}`);
  }
  
  if (modification.type === 'update' && modification.content === undefined) {
    throw new Error(`Content is required for 'update' modification type in file: ${modification.filePath}`);
  }
  
  if (modification.type === 'delete' && modification.content !== undefined) {
    // For delete operations, content should be undefined but we'll just ignore it
    console.warn(`Warning: content provided for 'delete' operation in file: ${modification.filePath}. Content will be ignored.`);
  }
};

/**
 * Delete a file
 * @param filePath - Path of the file to delete
 */
const deleteFile = async (filePath: string): Promise<void> => {
  if (await fs.pathExists(filePath)) {
    await fs.unlink(filePath);
    console.log(`Deleted file: ${filePath}`);
  } else {
    console.warn(`File does not exist, cannot delete: ${filePath}`);
  }
};

/**
 * Simple code merging strategy (in a real implementation, this would be more sophisticated)
 * @param existingContent - Existing file content
 * @param newContent - New content to merge
 * @returns Merged content
 */
const mergeCode = (existingContent: string, newContent: string): string => {
  // For now, implement a simple strategy - just append unique content
  // In a real implementation, you might want to use more sophisticated merging logic
  if (!existingContent) return newContent;
  if (!newContent) return existingContent;
  
  // Check if the new content is already present in existing content to avoid duplication
  if (existingContent.includes(newContent.trim())) {
    return existingContent;
  }
  
  // In real implementation, we might analyze the code structure and merge intelligently
  return existingContent + '\n\n' + newContent;
};

/**
 * Generate code modification requests from AI response
 * @param aiResponse - Response from the AI that may contain code modifications
 * @returns List of code modifications to apply
 */
export const parseModificationsFromResponse = (aiResponse: string): CodeModification[] => {
  const modifications: CodeModification[] = [];
  
  // Regex to find code blocks with file information
  // This looks for patterns like ```filename.js ...code... ```
  const fileRegex = /```([\w\.\/\-\_]+)\n([\s\S]*?)```/g;
  let match;
  
  while ((match = fileRegex.exec(aiResponse)) !== null) {
    const filePath = match[1];
    const content = match[2];
    
    // Determine modification type based on if file exists
    modifications.push({
      type: 'update', // Default to update
      filePath: filePath,
      content: content,
      method: 'replace'
    });
  }
  
  // Also look for create-specific patterns in the response
  const createRegex = /Create file "([^"]+)" with content:\s*```(?:\w+)?\n([\s\S]*?)```/gi;
  while ((match = createRegex.exec(aiResponse)) !== null) {
    const filePath = match[1];
    const content = match[2];
    
    modifications.push({
      type: 'create',
      filePath: filePath,
      content: content
    });
  }
  
  // Look for delete patterns
  const deleteRegex = /Delete file "([^"]+)"/gi;
  while ((match = deleteRegex.exec(aiResponse)) !== null) {
    const filePath = match[1];
    
    modifications.push({
      type: 'delete',
      filePath: filePath,
      content: undefined // Delete operations don't need content
    });
  }
  
  return modifications;
};

/**
 * Prepare context about project files for the AI
 * @param projectAnalysis - Analysis of the project
 * @param filePaths - Specific file paths to include (if null, all files are considered)
 * @returns Context string with file contents
 */
export const prepareFileContext = (
  projectAnalysis: ProjectAnalysisResult, 
  filePaths: string[] | null = null
): string => {
  const contextLines: string[] = [];
  
  if (!filePaths) {
    // Include all config files
    for (const configFile of projectAnalysis.configFiles) {
      contextLines.push(`File: ${configFile.relativePath}`);
      contextLines.push('```');
      contextLines.push(configFile.content);
      contextLines.push('```');
      contextLines.push(''); // Empty line for separation
    }
    
    // Include up to 5 code files (to avoid overwhelming the AI)
    const codeFiles = Object.entries(projectAnalysis.codeContent).slice(0, 5);
    for (const [filePath, content] of codeFiles) {
      contextLines.push(`File: ${filePath}`);
      contextLines.push('```');
      contextLines.push(content);
      contextLines.push('```');
      contextLines.push(''); // Empty line for separation
    }
  } else {
    // Only include specified files
    for (const filePath of filePaths) {
      if (projectAnalysis.codeContent[filePath]) {
        contextLines.push(`File: ${filePath}`);
        contextLines.push('```');
        contextLines.push(projectAnalysis.codeContent[filePath]);
        contextLines.push('```');
        contextLines.push(''); // Empty line for separation
      } else {
        // Check if it's a config file
        const configFile = projectAnalysis.configFiles.find(cf => cf.relativePath === filePath);
        if (configFile) {
          contextLines.push(`File: ${configFile.relativePath}`);
          contextLines.push('```');
          contextLines.push(configFile.content);
          contextLines.push('```');
          contextLines.push(''); // Empty line for separation
        } else {
          console.warn(`File not found in project: ${filePath}`);
        }
      }
    }
  }
  
  return contextLines.join('\n');
};

/**
 * Modification types
 */
export type ModificationType = 'create' | 'update' | 'delete';

/**
 * How to apply content to an existing file
 */
export type ModificationMethod = 'replace' | 'append' | 'prepend' | 'merge';

/**
 * Represents a code modification operation
 */
export interface CodeModification {
  type: ModificationType;
  filePath: string;
  content?: string; // Not required for 'delete' operations
  method?: ModificationMethod; // Only used for 'update' type
}