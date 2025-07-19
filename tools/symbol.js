import path from "path";
import Parser from "tree-sitter";
import JS from "tree-sitter-javascript";
import CPP from "tree-sitter-cpp";
import Python from "tree-sitter-python";
import { ChatService } from "@token-ring/chat";
import { FileSystemService } from "@token-ring/filesystem";
import { z } from "zod";

/**
 * Create or replace a specific symbol (function, class, variable, etc.) in a source code file
 * using Tree-sitter for precise parsing and modification. Supports nested symbols like methods within classes.
 *
 * @param {Object} params - Parameters for the symbol operation.
 * @param {string} params.path - Path of the file to modify, relative to the source directory.
 * @param {string} params.symbolName - Name of the symbol to create or replace.
 * @param {string} params.symbolType - Type of symbol: 'function', 'class', 'variable', 'method', 'export', 'constructor', 'property'.
 * @param {string} params.content - The new content for the symbol (complete implementation).
 * @param {string} [params.parentClass] - Name of the parent class when working with methods, constructors, or properties.
 * @param {TokenRingRegistry} registry - The package registry
 * @returns {Promise<string>} - A message indicating the result of the operation.
 */
export async function execute(
	{ path: filePath, symbolName, symbolType, content, parentClass },
	registry,
) {
	const chatService = registry.requireFirstServiceByType(ChatService);
	const fileSystem = registry.requireFirstServiceByType(FileSystemService);

	const symbolDescription = parentClass
		? `${symbolType} '${symbolName}' in class '${parentClass}'`
		: `${symbolType} '${symbolName}'`;
	chatService.infoLine(
		`[RepoMap] Modifying ${symbolDescription} in ${filePath}`,
	);

	try {
		// Check if file exists
		const fileExists = await fileSystem.exists(filePath);
		if (!fileExists) {
			return `Error: File ${filePath} not found. Please create the file first.`;
		}

		// Load the appropriate language parser
		const lang = loadLanguage(path.extname(filePath));
		if (!lang) {
			return `Error: Unsupported file type for ${filePath}. Supported: .js, .jsx, .ts, .tsx, .py, .c, .cpp, .h, .hpp`;
		}

		// Read the current file content
		const originalCode = await fileSystem.getFile(filePath);
		const parser = new Parser();
		parser.setLanguage(lang);
		const tree = parser.parse(originalCode);

		let newCode;

		if (parentClass) {
			// Working with a symbol inside a class
			const classSymbol = findSymbol(tree, parentClass, "class");
			if (!classSymbol) {
				return `Error: Parent class '${parentClass}' not found in ${filePath}.`;
			}

			const existingSymbol = findSymbolInClass(
				classSymbol.node,
				symbolName,
				symbolType,
			);

			if (existingSymbol) {
				newCode = replaceSymbol(originalCode, existingSymbol, content);
			} else {
				newCode = createSymbolInClass(
					originalCode,
					classSymbol,
					content,
					symbolType,
				);
			}
		} else {
			// Working with a top-level symbol
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

		// Write the modified content back to the file
		const success = await fileSystem.writeFile(filePath, newCode);

		if (success) {
			fileSystem.setDirty(true);
			chatService.infoLine(
				`[RepoMap] Successfully modified ${symbolDescription} in ${filePath}`,
			);
			return `${symbolDescription} successfully modified`;
		} else {
			return `Error: Failed to write changes to ${filePath}`;
		}
	} catch (err) {
		chatService.errorLine(`[symbol] Error: ${err.message}`);
		return `Error modifying symbol: ${err.message}`;
	}
}

/**
 * Load the appropriate Tree-sitter language parser based on file extension
 */
function loadLanguage(ext) {
	switch (ext) {
		case ".js":
		case ".jsx":
		case ".ts":
		case ".tsx":
			return JS;
		case ".py":
			return Python;
		case ".h":
		case ".c":
		case ".hxx":
		case ".cxx":
		case ".hpp":
		case ".cpp":
			return CPP;
		default:
			return null;
	}
}

/**
 * Find a specific symbol in the parsed tree
 */
function findSymbol(tree, symbolName, symbolType) {
	const symbolTypes = {
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

	function traverse() {
		const node = cursor.currentNode;

		if (targetTypes.includes(node.type)) {
			let nameNode = node.childForFieldName?.("name");

			// Handle special cases for different node types
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

				// Special handling for constructors
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

		// Visit children
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

/**
 * Find a symbol within a specific class node
 */
function findSymbolInClass(classNode, symbolName, symbolType) {
	const symbolTypes = {
		method: ["method_definition"],
		constructor: ["method_definition"],
		property: ["property_definition", "field_definition", "method_definition"],
	};

	const targetTypes = symbolTypes[symbolType] || [symbolType];
	const cursor = classNode.walk();

	function traverse() {
		const node = cursor.currentNode;

		if (targetTypes.includes(node.type)) {
			let nameNode = node.childForFieldName?.("name");

			if (node.type === "method_definition") {
				nameNode = node.childForFieldName("name");

				// Special handling for constructors
				if (
					symbolType === "constructor" &&
					nameNode &&
					nameNode.text === "constructor"
				) {
					return createSymbolInfo(node);
				}

				// For getter/setter properties that are methods
				if (
					symbolType === "property" &&
					nameNode &&
					nameNode.text === symbolName
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

		// Visit children (but don't go into nested classes)
		if (cursor.gotoFirstChild()) {
			do {
				// Skip nested class definitions
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

/**
 * Create symbol info object
 */
function createSymbolInfo(node) {
	return {
		node: node,
		startPosition: node.startPosition,
		endPosition: node.endPosition,
		text: node.text,
	};
}

/**
 * Replace an existing symbol with new content
 */
function replaceSymbol(originalCode, existingSymbol, newContent) {
	const lines = originalCode.split("\n");
	const startLine = existingSymbol.startPosition.row;
	const endLine = existingSymbol.endPosition.row;
	const startColumn = existingSymbol.startPosition.column;
	const endColumn = existingSymbol.endPosition.column;

	// Handle single-line replacement
	if (startLine === endLine) {
		const line = lines[startLine];
		lines[startLine] =
			line.substring(0, startColumn) + newContent + line.substring(endColumn);
	} else {
		// Handle multi-line replacement
		const firstLine = lines[startLine].substring(0, startColumn);
		const lastLine = lines[endLine].substring(endColumn);

		// Replace the old symbol lines with new content
		const newContentLines = newContent.split("\n");
		newContentLines[0] = firstLine + newContentLines[0];
		newContentLines[newContentLines.length - 1] =
			newContentLines[newContentLines.length - 1] + lastLine;

		lines.splice(startLine, endLine - startLine + 1, ...newContentLines);
	}

	return lines.join("\n");
}

/**
 * Create a new symbol within a class
 */
function createSymbolInClass(originalCode, classSymbol, content, symbolType) {
	const lines = originalCode.split("\n");
	const classEndLine = classSymbol.endPosition.row;
	const classEndColumn = classSymbol.endPosition.column;

	// Find the last closing brace of the class
	let insertLine = classEndLine;

	// Look for the actual closing brace by examining the class structure
	const classLines = lines.slice(
		classSymbol.startPosition.row,
		classEndLine + 1,
	);

	// Find the best place to insert within the class (before the closing brace)
	// We'll insert before the last line that contains the closing brace
	const lastLine = lines[classEndLine];
	const beforeClosingBrace = lastLine.substring(0, classEndColumn - 1);
	const afterClosingBrace = lastLine.substring(classEndColumn - 1);

	// Add proper indentation to the content
	const classIndent = getIndentation(lines[classSymbol.startPosition.row]);
	const contentIndent = classIndent + "  "; // Add 2 spaces for class member indentation
	const indentedContent = content
		.split("\n")
		.map((line) => (line.trim() ? contentIndent + line : line))
		.join("\n");

	// Insert the new content before the closing brace
	lines[insertLine] =
		beforeClosingBrace +
		"\n" +
		indentedContent +
		"\n" +
		classIndent +
		afterClosingBrace;

	return lines.join("\n");
}

/**
 * Get the indentation of a line
 */
function getIndentation(line) {
	const match = line.match(/^(\s*)/);
	return match ? match[1] : "";
}

export const description =
	"Create or replace specific symbols (functions, classes, variables, methods, constructors, properties) in source code files using Tree-sitter parsing. Supports nested symbols like methods within classes.";

// Tool spec is now a zod schema instead of JSON schema
export const parameters = z.object({
	path: z
		.string()
		.describe(
			"Path of the source file to modify. Note: It is unnecessary and redundant to call the file tool after using this tool to modify the file.",
		),
	symbolName: z
		.string()
		.describe(
			"Name of the symbol to create or replace. Use 'constructor' for class constructors.",
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
			"Complete implementation of the symbol (e.g., entire function definition including signature and body). An empty string will delete the symbol.",
		),
	parentClass: z
		.string()
		.describe(
			"Name of the parent class when working with methods, constructors, or properties within a class.",
		)
		.optional(),
});
