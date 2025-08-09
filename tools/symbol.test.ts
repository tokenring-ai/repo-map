// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execute as executeSymbol } from "./symbol.ts";
import { ServiceRegistry } from "@token-ring/registry";
import { FileSystemService } from "@token-ring/filesystem";
import { ChatService } from "@token-ring/chat";

class MockFileSystemService extends FileSystemService {
  files = new Map<string, string>();
  isDirty = false;

  async getFile(filePath: string) {
    return this.files.get(filePath) || null;
  }

  async writeFile(filePath: string, content: string) {
    this.files.set(filePath, content);
    this.isDirty = true;
    return true;
  }

  async exists(filePath: string) {
    return this.files.has(filePath);
  }

  setDirty(dirty: boolean) {
    this.isDirty = dirty;
  }
}

class MockChatService extends ChatService {
  messages: { type: string; message: string }[] = [];

  infoLine(message: string) {
    this.messages.push({ type: "info", message });
  }

  errorLine(message: string) {
    this.messages.push({ type: "error", message });
  }

  systemLine(message: string) {
    this.messages.push({ type: "system", message });
  }
}

describe("@token-ring/repo-map tools/symbol.ts", () => {
  let registry: any;
  let mockFileSystemService: MockFileSystemService;
  let mockChatService: MockChatService;

  beforeEach(() => {
    registry = new ServiceRegistry();
    mockFileSystemService = new MockFileSystemService();
    mockChatService = new MockChatService();

    registry.registerService(mockFileSystemService);
    registry.registerService(mockChatService);
    vi.clearAllMocks();
  });

  describe("JavaScript Symbol Manipulation", () => {
    it("should create a new top-level function in an empty JS file", async () => {
      const filePath = "test.js";
      const functionName = "helloWorld";
      const functionContent =
        'function helloWorld() {\n  console.log("Hello, World!");\n}';

      await mockFileSystemService.writeFile(filePath, "");

      const result = await executeSymbol(
        {
          path: filePath,
          symbolName: functionName,
          symbolType: "function",
          content: functionContent,
        },
        registry
      );

      expect(result).toBe(`function '${functionName}' successfully modified`);
      const modifiedCode = await mockFileSystemService.getFile(filePath);
      expect(modifiedCode).toContain(functionContent);
      expect(modifiedCode?.trim()).toBe(functionContent.trim());
    });

    it("should create a new top-level function in a JS file with existing content", async () => {
      const filePath = "test.js";
      const initialContent = "const x = 10;\n";
      await mockFileSystemService.writeFile(filePath, initialContent);

      const functionName = "sayHi";
      const functionContent = 'function sayHi() {\n  console.log("Hi!");\n}';

      const result = await executeSymbol(
        {
          path: filePath,
          symbolName: functionName,
          symbolType: "function",
          content: functionContent,
        },
        registry
      );

      expect(result).toBe(`function '${functionName}' successfully modified`);
      const modifiedCode = await mockFileSystemService.getFile(filePath);
      expect(modifiedCode).toContain(initialContent);
      expect(modifiedCode).toContain(functionContent);
      expect(modifiedCode?.trim()).toBe((initialContent + functionContent).trim());
    });

    it("should replace an existing top-level function in a JS file", async () => {
      const filePath = "test.js";
      const functionName = "greet";
      const oldFunctionContent =
        'function greet() {\n  console.log("Old greeting");\n}';
      const newFunctionContent =
        'function greet() {\n  console.log("New greeting");\n}';
      await mockFileSystemService.writeFile(filePath, oldFunctionContent);

      const result = await executeSymbol(
        {
          path: filePath,
          symbolName: functionName,
          symbolType: "function",
          content: newFunctionContent,
        },
        registry
      );

      expect(result).toBe(`function '${functionName}' successfully modified`);
      const modifiedCode = await mockFileSystemService.getFile(filePath);
      expect(modifiedCode).toBe(newFunctionContent);
      expect(modifiedCode).not.toContain("Old greeting");
    });

    it("should delete an existing top-level function when content is an empty string", async () => {
      const filePath = "test.js";
      const functionName = "toBeDeleted";
      const functionContent =
        'function toBeDeleted() {\n  console.log("Delete me!");\n}';
      const otherContent = "const y = 20;";
      await mockFileSystemService.writeFile(
        filePath,
        `${functionContent}\n${otherContent}`
      );

      const result = await executeSymbol(
        {
          path: filePath,
          symbolName: functionName,
          symbolType: "function",
          content: "",
        },
        registry
      );

      expect(result).toBe(`function '${functionName}' successfully modified`);
      const modifiedCode = await mockFileSystemService.getFile(filePath);
      expect(modifiedCode).not.toContain("Delete me!");
      expect(modifiedCode?.trim()).toBe(otherContent.trim());
    });

    it("should return an error if trying to modify a symbol in a non-existent file", async () => {
      const result = await executeSymbol(
        {
          path: "nonexistent.js",
          symbolName: "testFunc",
          symbolType: "function",
          content: "function testFunc() {}",
        },
        registry
      );
      expect(result).toBe(
        "Error: File nonexistent.js not found. Please create the file first."
      );
    });

    it("should return an error for unsupported file types", async () => {
      const filePath = "test.txt";
      await mockFileSystemService.writeFile(filePath, "some text");
      const result = await executeSymbol(
        {
          path: filePath,
          symbolName: "testFunc",
          symbolType: "function",
          content: "function testFunc() {}",
        },
        registry
      );
      expect(result).toContain("Error: Unsupported file type for test.txt");
    });
  });
});
