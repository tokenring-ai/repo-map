// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute as executeSymbol } from './symbol.js'; // Assuming execute is exported from symbol.js
import { ServiceRegistry } from '@token-ring/registry'; // Assuming ServiceRegistry is available for mocking
import { FileSystemService } from '@token-ring/filesystem'; // To mock
import { ChatService } from '@token-ring/chat'; // To mock

// Mock FileSystemService
class MockFileSystemService extends FileSystemService {
  constructor() {
    super();
    this.files = new Map();
    this.isDirty = false;
  }

  async getFile(filePath) {
    return this.files.get(filePath) || null;
  }

  async writeFile(filePath, content) {
    this.files.set(filePath, content);
    this.isDirty = true;
    return true;
  }

  async exists(filePath) {
    return this.files.has(filePath);
  }

  setDirty(dirty) {
    this.isDirty = dirty;
  }

  // Add any other methods used by symbol.js if necessary
}

// Mock ChatService
class MockChatService extends ChatService {
  constructor() {
    super();
    this.messages = [];
  }

  infoLine(message) {
    this.messages.push({ type: 'info', message });
    // console.log(`INFO: ${message}`);
  }

  errorLine(message) {
    this.messages.push({ type: 'error', message });
    // console.error(`ERROR: ${message}`);
  }

  systemLine(message) {
    this.messages.push({ type: 'system', message });
    // console.log(`SYSTEM: ${message}`);
  }
  // Add any other methods used by symbol.js if necessary
}

describe('@token-ring/repo-map tools/symbol.js', () => {
  let registry;
  let mockFileSystemService;
  let mockChatService;

  beforeEach(() => {
    registry = new ServiceRegistry();
    mockFileSystemService = new MockFileSystemService();
    mockChatService = new MockChatService();

    registry.registerService(mockFileSystemService);
    registry.registerService(mockChatService);
    vi.clearAllMocks(); // Clear mocks before each test
  });

  describe('JavaScript Symbol Manipulation', () => {
    it('should create a new top-level function in an empty JS file', async () => {
      const filePath = 'test.js';
      const functionName = 'helloWorld';
      const functionContent = 'function helloWorld() {\n  console.log("Hello, World!");\n}';

      // Simulate file not existing initially, then existing after potential implicit creation by tool (or ensure it exists)
      // For this tool, file must exist.
      await mockFileSystemService.writeFile(filePath, ''); // Create empty file

      const result = await executeSymbol({
        path: filePath,
        symbolName: functionName,
        symbolType: 'function',
        content: functionContent,
      }, registry);

      expect(result).toBe(`function '${functionName}' successfully modified`);
      const modifiedCode = await mockFileSystemService.getFile(filePath);
      expect(modifiedCode).toContain(functionContent);
      // More specific check for append:
      expect(modifiedCode.trim()).toBe(functionContent.trim());
    });

    it('should create a new top-level function in a JS file with existing content', async () => {
      const filePath = 'test.js';
      const initialContent = 'const x = 10;\n';
      await mockFileSystemService.writeFile(filePath, initialContent);

      const functionName = 'sayHi';
      const functionContent = 'function sayHi() {\n  console.log("Hi!");\n}';

      const result = await executeSymbol({
        path: filePath,
        symbolName: functionName,
        symbolType: 'function',
        content: functionContent,
      }, registry);

      expect(result).toBe(`function '${functionName}' successfully modified`);
      const modifiedCode = await mockFileSystemService.getFile(filePath);
      expect(modifiedCode).toContain(initialContent);
      expect(modifiedCode).toContain(functionContent);
      // Expect it to be appended
      expect(modifiedCode.trim()).toBe((initialContent + functionContent).trim());
    });

    it('should replace an existing top-level function in a JS file', async () => {
      const filePath = 'test.js';
      const functionName = 'greet';
      const oldFunctionContent = 'function greet() {\n  console.log("Old greeting");\n}';
      const newFunctionContent = 'function greet() {\n  console.log("New greeting");\n}';
      await mockFileSystemService.writeFile(filePath, oldFunctionContent);

      const result = await executeSymbol({
        path: filePath,
        symbolName: functionName,
        symbolType: 'function',
        content: newFunctionContent,
      }, registry);

      expect(result).toBe(`function '${functionName}' successfully modified`);
      const modifiedCode = await mockFileSystemService.getFile(filePath);
      expect(modifiedCode).toBe(newFunctionContent);
      expect(modifiedCode).not.toContain('Old greeting');
    });

    it('should delete an existing top-level function when content is an empty string', async () => {
      const filePath = 'test.js';
      const functionName = 'toBeDeleted';
      const functionContent = 'function toBeDeleted() {\n  console.log("Delete me!");\n}';
      const otherContent = 'const y = 20;';
      await mockFileSystemService.writeFile(filePath, `${functionContent}\n${otherContent}`);

      const result = await executeSymbol({
        path: filePath,
        symbolName: functionName,
        symbolType: 'function',
        content: '', // Empty string to delete
      }, registry);

      expect(result).toBe(`function '${functionName}' successfully modified`);
      const modifiedCode = await mockFileSystemService.getFile(filePath);
      // The exact output might vary slightly based on how replacement handles newlines.
      // It should remove the function content.
      expect(modifiedCode).not.toContain('Delete me!');
      expect(modifiedCode.trim()).toBe(otherContent.trim());
    });

    it('should return an error if trying to modify a symbol in a non-existent file', async () => {
        const result = await executeSymbol({
            path: 'nonexistent.js',
            symbolName: 'testFunc',
            symbolType: 'function',
            content: 'function testFunc() {}'
        }, registry);
        expect(result).toBe('Error: File nonexistent.js not found. Please create the file first.');
    });

    it('should return an error for unsupported file types', async () => {
        const filePath = 'test.txt';
        await mockFileSystemService.writeFile(filePath, 'some text');
        const result = await executeSymbol({
            path: filePath,
            symbolName: 'testFunc',
            symbolType: 'function',
            content: 'function testFunc() {}'
        }, registry);
        expect(result).toContain('Error: Unsupported file type for test.txt');
    });

  });

  // TODO: Add tests for other languages (Python, C++)
  // TODO: Add tests for class and method manipulation
  // TODO: Add tests for variable and export manipulation
  // TODO: Add tests for edge cases (e.g., syntax errors in content - though tree-sitter might not care for content, only for parsing existing)
});
