import {ChatService} from "@token-ring/chat";
import {FileSystemService} from "@token-ring/filesystem";
import {Registry} from "@token-ring/registry";
import path from "path";
import Parser from "tree-sitter";
import LanguageC from "tree-sitter-c"
import LanguageCPP from "tree-sitter-cpp";
import LanguageJavascript from "tree-sitter-javascript"
import LanguagePython from "tree-sitter-python";
import {z} from "zod";

export const name = "repo-map/symbol";

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

// Define a specific type for symbol information instead of using any
export interface SymbolInfo {
  node: Parser.SyntaxNode;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text: string;
}

export async function execute(
  {path: filePath, symbolName, symbolType, content, parentClass}: ExecuteParams,
  registry: Registry
): Promise<string> {
  if (!filePath || !symbolName || !symbolType || content === undefined) {
    throw new Error(`[${name}] Missing required parameters. Please provide path, symbolName, symbolType, and content.`);
  }

  const chatService = registry.requireFirstServiceByType(ChatService);
  const fileSystem = registry.requireFirstServiceByType(FileSystemService);

  const symbolDescription = parentClass
    ? `${symbolType} '${symbolName}' in class '${parentClass}'`
    : `${symbolType} '${symbolName}'`;
  chatService.infoLine(
    `[${name}] Modifying ${symbolDescription} in ${filePath}`
  );

  const fileExists = await fileSystem.exists(filePath);
  if (!fileExists) {
    throw new Error(`[${name}] File ${filePath} not found. Please create the file first.`);
  }

  const ext = path.extname(filePath);
  const supported = [".js", ".jsx", ".ts", ".tsx", ".py", ".c", ".cpp", ".h", ".hpp", ".hxx", ".cxx"];
  if (!supported.includes(ext)) {
    throw new Error(`[${name}] Unsupported file type for ${filePath}. Supported: .js, .jsx, .ts, .tsx, .py, .c, .cpp, .h, .hpp`);
  }

  const originalCode: string = (await fileSystem.getFile(filePath)) ?? "";

  // Fast path: JS/TS top-level function manipulation without tree-sitter
  if ((!parentClass) && symbolType === "function" && [".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
    let newCode: string | undefined;
    const range = findTopLevelFunctionRange(originalCode, symbolName);
    if (range) {
      if (content === "") {
        newCode = originalCode.slice(0, range.start) + originalCode.slice(range.end);
        // Normalize potential excessive blank lines created by deletion
        newCode = newCode.replace(/\n{3,}/g, "\n\n");
      } else {
        newCode = originalCode.slice(0, range.start) + content + originalCode.slice(range.end);
      }
    } else {
      if ((originalCode ?? "").trim() === "") {
        newCode = content.trim();
      } else {
        newCode = `${originalCode.trim()}\n${content.trim()}`;
      }
    }

    const success = await fileSystem.writeFile(filePath, newCode);
    if (success) {
      fileSystem.setDirty(true);
      chatService.infoLine(
        `[${name}] Successfully modified ${symbolDescription} in ${filePath}`
      );
      return `${symbolDescription} successfully modified`;
    } else {
      throw new Error(`[${name}] Failed to write changes to ${filePath}`);
    }
  }

  // Tree-sitter path for other languages or nested cases
  let newCode: string | undefined;

  const parser = new Parser()

  const lang = await loadLanguage(ext);
  if (!lang) {
    throw new Error(`[${name}] Unsupported file type for ${filePath}. Supported: .js, .jsx, .ts, .tsx, .py, .c, .cpp, .h, .hpp`);
  }
  parser.setLanguage(lang);
  const tree = parser.parse(originalCode);

  if (parentClass) {
    const classSymbol = findSymbol(tree, parentClass, "class");
    if (!classSymbol) {
      throw new Error(`[${name}] Parent class '${parentClass}' not found in ${filePath}.`);
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
        classSymbol as SymbolInfo,
        content,
        symbolType
      );
    }
  } else {
    const existingSymbol = findSymbol(tree, symbolName, symbolType);

    if (existingSymbol) {
      if (content === "") {
        newCode = deleteSymbol(originalCode, existingSymbol);
      } else {
        newCode = replaceSymbol(originalCode, existingSymbol, content);
      }
    } else {
      if ((originalCode ?? "").trim() === "") {
        newCode = content.trim();
      } else {
        newCode = `${originalCode.trim()}\n${content.trim()}`;
      }
    }
  }

  if (!newCode) {
    throw new Error(`[${name}] Failed to generate modified code.`);
  }

  const success = await fileSystem.writeFile(filePath, newCode);

  if (success) {
    fileSystem.setDirty(true);
    chatService.infoLine(
      `[${name}] Successfully modified ${symbolDescription} in ${filePath}`
    );
    return `${symbolDescription} successfully modified`;
  } else {
    throw new Error(`[${name}] Failed to write changes to ${filePath}`);
  }
}

async function loadLanguage(ext: string): Promise<Parser.Language | null> {
  switch (ext) {
    case ".js":
    case ".jsx":
    case ".ts":
    case ".tsx":
      return LanguageJavascript as Parser.Language;
    case ".py":
      return LanguagePython as Parser.Language;
    case ".h":
    case ".c":
      return LanguageC as Parser.Language;
    case ".hxx":
    case ".cxx":
    case ".hpp":
    case ".cpp":
      return LanguageCPP as Parser.Language;
    default:
      return null;
  }
}

function findSymbol(tree: Parser.Tree, symbolName: string, symbolType: string): SymbolInfo | null {
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

  function traverse(): SymbolInfo | null {
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
  classNode: Parser.SyntaxNode,
  symbolName: string,
  symbolType: string
): SymbolInfo | null {
  const symbolTypes: Record<string, string[]> = {
    method: ["method_definition"],
    constructor: ["method_definition"],
    property: ["property_definition", "field_definition", "method_definition"],
  };

  const targetTypes = symbolTypes[symbolType] || [symbolType];
  const cursor = classNode.walk();

  function traverse(): SymbolInfo | null {
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

function createSymbolInfo(node: Parser.SyntaxNode): SymbolInfo {
  return {
    node: node,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    text: node.text,
  };
}

function replaceSymbol(originalCode: string, existingSymbol: SymbolInfo, newContent: string) {
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
  classSymbol: SymbolInfo,
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

export const inputSchema = z.object({
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

function deleteSymbol(originalCode: string, existingSymbol: SymbolInfo) {
  const lines = originalCode.split("\n");
  const startLine = existingSymbol.startPosition.row;
  const endLine = existingSymbol.endPosition.row;
  const startColumn = existingSymbol.startPosition.column;
  const endColumn = existingSymbol.endPosition.column;

  // If the symbol starts at column 0, assume it spans full lines and remove those lines.
  if (startColumn === 0) {
    lines.splice(startLine, endLine - startLine + 1);

    // Clean up potential extra blank lines at the splice point
    if (startLine > 0 && startLine < lines.length) {
      if (lines[startLine].trim() === "" && lines[startLine - 1].trim() === "") {
        lines.splice(startLine, 1);
      }
    }

    return lines.join("\n");
  }

  // Fallback: replace symbol text with empty string and normalize excessive blank lines
  const replaced = replaceSymbol(originalCode, existingSymbol, "");
  return replaced.replace(/\n{3,}/g, "\n\n");
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTopLevelFunctionRange(code: string, name: string): { start: number; end: number } | null {
  const n = escapeRegExp(name);
  const pattern = new RegExp(`(^|\\n)\\s*function\\s+${n}\\s*\\(`);
  const match = pattern.exec(code);
  if (!match) return null;
  // Start at the beginning of the matched "function" keyword
  let start = match.index + (match[1] ? match[1].length : 0);

  // Find the opening brace following the function signature
  // Move to first '{'
  const openParen = code.indexOf("(", start);
  if (openParen === -1) return null;
  const closeParen = code.indexOf(")", openParen + 1);
  if (closeParen === -1) return null;
  const openBrace = code.indexOf("{", closeParen + 1);
  if (openBrace === -1) return null;

  let i = openBrace;
  let depth = 0;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // Include the closing brace
        const end = i + 1;
        return {start, end};
      }
    }
  }
  return null;
}
