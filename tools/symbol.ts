import path from "path";
import Parser from "tree-sitter";
import JS from "tree-sitter-javascript";
import CPP from "tree-sitter-cpp";
import Python from "tree-sitter-python";
import { ChatService } from "@token-ring/chat";
import { FileSystemService } from "@token-ring/filesystem";
import { z } from "zod";
import {Registry} from "@token-ring/registry";

export interface ExecuteParams {
  path?: string;
  symbolName?: string;
  symbolType?:
    | "function"
    | "class"
    | "variable"
    | "method"
    | "export"
    | "constructor"
    | "property";
  content?: string;
  parentClass?: string;
}

export async function execute(
  { path: filePath, symbolName, symbolType, content, parentClass }: ExecuteParams,
  registry: Registry
): Promise<string> {
  if (!filePath || !symbolName || !symbolType || !content) {
      return `Error: Missing required parameters. Please provide path, symbolName, symbolType, and content.`;
  }


  const chatService = registry.requireFirstServiceByType(ChatService);
  const fileSystem = registry.requireFirstServiceByType(FileSystemService);

  const symbolDescription = parentClass
    ? `${symbolType} '${symbolName}' in class '${parentClass}'`
    : `${symbolType} '${symbolName}'`;
  chatService.infoLine(
    `[RepoMap] Modifying ${symbolDescription} in ${filePath}`
  );


  try {
    const fileExists = await fileSystem.exists(filePath);
    if (!fileExists) {
      return `Error: File ${filePath} not found. Please create the file first.`;
    }

    const lang = loadLanguage(path.extname(filePath));
    if (!lang) {
      return `Error: Unsupported file type for ${filePath}. Supported: .js, .jsx, .ts, .tsx, .py, .c, .cpp, .h, .hpp`;
    }

    const originalCode: string = await fileSystem.getFile(filePath);
    const parser: any = new (Parser as any)();
    parser.setLanguage(lang);
    const tree = parser.parse(originalCode);

    let newCode: string | undefined;

    if (parentClass) {
      const classSymbol = findSymbol(tree, parentClass, "class");
      if (!classSymbol) {
        return `Error: Parent class '${parentClass}' not found in ${filePath}.`;
      }

      const existingSymbol = findSymbolInClass(
        classSymbol.node,
        symbolName,
        symbolType
      );

      if (existingSymbol) {
        newCode = replaceSymbol(originalCode, existingSymbol, content);
      } else {
        newCode = createSymbolInClass(
          originalCode,
          classSymbol as any,
          content,
          symbolType
        );
      }
    } else {
      const existingSymbol = findSymbol(tree, symbolName, symbolType);

      if (existingSymbol) {
        newCode = replaceSymbol(originalCode, existingSymbol, content);
      } else {
        newCode = `${originalCode.trim()}\n${content.trim()}`;
      }
    }

    if (!newCode) {
      return `Error: Failed to generate modified code.`;
    }

    const success = await fileSystem.writeFile(filePath, newCode);

    if (success) {
      fileSystem.setDirty(true);
      chatService.infoLine(
        `[RepoMap] Successfully modified ${symbolDescription} in ${filePath}`
      );
      return `${symbolDescription} successfully modified`;
    } else {
      return `Error: Failed to write changes to ${filePath}`;
    }
  } catch (err: any) {
    chatService.errorLine(`[symbol] Error: ${err.message}`);
    return `Error modifying symbol: ${err.message}`;
  }
}

function loadLanguage(ext: string): any | null {
  switch (ext) {
    case ".js":
    case ".jsx":
    case ".ts":
    case ".tsx":
      return JS as any;
    case ".py":
      return Python as any;
    case ".h":
    case ".c":
    case ".hxx":
    case ".cxx":
    case ".hpp":
    case ".cpp":
      return CPP as any;
    default:
      return null;
  }
}

function findSymbol(tree: any, symbolName: string, symbolType: string) {
  const symbolTypes: Record<string, string[]> = {
    function: ["function_declaration", "function_definition"],
    class: ["class_declaration", "class_definition"],
    variable: [
      "variable_declarator",
      "lexical_declaration",
      "variable_declaration",
    ],
    method: ["method_definition"],
    export: ["export_statement"],
    constructor: ["method_definition"],
    property: ["property_definition", "field_definition"],
  };

  const targetTypes = symbolTypes[symbolType] || [symbolType];
  const cursor = tree.walk();

  function traverse(): any {
    const node = cursor.currentNode;

    if (targetTypes.includes(node.type)) {
      let nameNode = node.childForFieldName?.("name");

      if (node.type === "export_statement") {
        const declaration = node.childForFieldName("declaration");
        if (declaration) {
          nameNode = declaration.childForFieldName("name");
        }
      } else if (
        node.type === "lexical_declaration" ||
        node.type === "variable_declaration"
      ) {
        const declarator = node.descendantsOfType("variable_declarator")[0];
        if (declarator) {
          nameNode = declarator.childForFieldName("name");
        }
      } else if (node.type === "method_definition") {
        nameNode = node.childForFieldName("name");

        if (
          symbolType === "constructor" &&
          nameNode &&
          nameNode.text === "constructor"
        ) {
          return createSymbolInfo(node);
        }
      }

      if (!nameNode) {
        nameNode = node.namedChild(0);
      }

      if (nameNode && nameNode.text === symbolName) {
        return createSymbolInfo(node);
      }
    }

    if (cursor.gotoFirstChild()) {
      do {
        const result = traverse();
        if (result) return result;
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }

    return null;
  }

  return traverse();
}

function findSymbolInClass(
  classNode: any,
  symbolName: string,
  symbolType: string
) {
  const symbolTypes: Record<string, string[]> = {
    method: ["method_definition"],
    constructor: ["method_definition"],
    property: ["property_definition", "field_definition", "method_definition"],
  };

  const targetTypes = symbolTypes[symbolType] || [symbolType];
  const cursor = classNode.walk();

  function traverse(): any {
    const node = cursor.currentNode;

    if (targetTypes.includes(node.type)) {
      let nameNode = node.childForFieldName?.("name");

      if (node.type === "method_definition") {
        nameNode = node.childForFieldName("name");

        if (
          symbolType === "constructor" &&
          nameNode &&
          nameNode.text === "constructor"
        ) {
          return createSymbolInfo(node);
        }

        if (symbolType === "property" && nameNode && nameNode.text === symbolName) {
          return createSymbolInfo(node);
        }
      }

      if (!nameNode) {
        nameNode = node.namedChild(0);
      }

      if (nameNode && nameNode.text === symbolName) {
        return createSymbolInfo(node);
      }
    }

    if (cursor.gotoFirstChild()) {
      do {
        if (
          cursor.currentNode.type !== "class_declaration" &&
          cursor.currentNode.type !== "class_definition"
        ) {
          const result = traverse();
          if (result) return result;
        }
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }

    return null;
  }

  return traverse();
}

function createSymbolInfo(node: any) {
  return {
    node: node,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    text: node.text,
  };
}

function replaceSymbol(originalCode: string, existingSymbol: any, newContent: string) {
  const lines = originalCode.split("\n");
  const startLine = existingSymbol.startPosition.row;
  const endLine = existingSymbol.endPosition.row;
  const startColumn = existingSymbol.startPosition.column;
  const endColumn = existingSymbol.endPosition.column;

  if (startLine === endLine) {
    const line = lines[startLine];
    lines[startLine] =
      line.substring(0, startColumn) + newContent + line.substring(endColumn);
  } else {
    const firstLine = lines[startLine].substring(0, startColumn);
    const lastLine = lines[endLine].substring(endColumn);

    const newContentLines = newContent.split("\n");
    newContentLines[0] = firstLine + newContentLines[0];
    newContentLines[newContentLines.length - 1] =
      newContentLines[newContentLines.length - 1] + lastLine;

    lines.splice(startLine, endLine - startLine + 1, ...newContentLines);
  }

  return lines.join("\n");
}

function createSymbolInClass(
  originalCode: string,
  classSymbol: any,
  content: string,
  _symbolType: string
) {
  const lines = originalCode.split("\n");
  const classEndLine = classSymbol.endPosition.row;
  const classEndColumn = classSymbol.endPosition.column;

  const insertLine = classEndLine;

  const lastLine = lines[classEndLine];
  const beforeClosingBrace = lastLine.substring(0, classEndColumn - 1);
  const afterClosingBrace = lastLine.substring(classEndColumn - 1);

  const classIndent = getIndentation(lines[classSymbol.startPosition.row]);
  const contentIndent = classIndent + "  ";
  const indentedContent = content
    .split("\n")
    .map((line) => (line.trim() ? contentIndent + line : line))
    .join("\n");

  lines[insertLine] =
    beforeClosingBrace +
    "\n" +
    indentedContent +
    "\n" +
    classIndent +
    afterClosingBrace;

  return lines.join("\n");
}

function getIndentation(line: string) {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

export const description =
  "Create or replace specific symbols (functions, classes, variables, methods, constructors, properties) in source code files using Tree-sitter parsing. Supports nested symbols like methods within classes.";

export const parameters = z.object({
  path: z
    .string()
    .describe(
      "Path of the source file to modify. Note: It is unnecessary and redundant to call the file tool after using this tool to modify the file."
    ),
  symbolName: z
    .string()
    .describe(
      "Name of the symbol to create or replace. Use 'constructor' for class constructors."
    ),
  symbolType: z
    .enum([
      "function",
      "class",
      "variable",
      "method",
      "export",
      "constructor",
      "property",
    ])
    .describe("Type of symbol to create or replace."),
  content: z
    .string()
    .describe(
      "Complete implementation of the symbol (e.g., entire function definition including signature and body). An empty string will delete the symbol."
    ),
  parentClass: z
    .string()
    .describe(
      "Name of the parent class when working with methods, constructors, or properties within a class."
    )
    .optional(),
});
