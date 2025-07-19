import { Service } from "@token-ring/registry";
import path from "path";
import Parser from "tree-sitter";
import JS from "tree-sitter-javascript";
import CPP from "tree-sitter-cpp";
import Python from "tree-sitter-python";
import { FileSystemService } from "@token-ring/filesystem";
import RepoMapResource from "./RepoMapResource.js";

export default class RepoMapService extends Service {
	/**
	 * Asynchronously yields memories from a repo map
	 * @param {TokenRingRegistry} registry - The registry object containing available services
	 * @async
	 * @generator
	 * @yields {{ role: string, content: string}} - Memories
	 */
	async *getMemories(registry) {
		const fileSystem = registry.requireFirstServiceByType(FileSystemService);

		const files = new Set();

		const resources = registry.resources.getResourcesByType(RepoMapResource);
		for (const resource of resources) {
			await resource.addFilesToSet(files, registry);
		}

		if (files.size > 0) {
			const repoMap = [];
			for (const file of files) {
				try {
					const lang = this.loadLanguage(path.extname(file));
					if (!lang) {
						// Optionally log unsupported file types if desired, or just skip silently
						// console.log(`[RepoMapService] Skipping unsupported file type: ${file}`);
						continue;
					}
					const parser = new Parser();
					parser.setLanguage(lang);
					const code = await fileSystem.getFile(file);
					if (code === null || code === undefined) {
						// Check if file content is valid
						console.error(
							`[RepoMapService] Error: Could not read content for file ${file}. Skipping.`,
						);
						continue;
					}
					const tree = parser.parse(code);
					const symbols = this.extractSymbols(tree, lang);

					// Format the file output with the new formatting style
					const formattedOutput = this.formatFileOutput(file, code, symbols);
					if (formattedOutput) repoMap.push(formattedOutput);
				} catch (error) {
					console.error(
						`[RepoMapService] Error processing file ${file}:`,
						error,
					);
					// Continue to the next file even if this one fails
				}
			}

			if (repoMap.length > 0) {
				yield {
					role: "user",
					content: `// These are snippets of the symbols in the project. This DOES NOT contain the full file contents. This only includes relevant symbols for you to reference so you know what to retrieve with the retrieveFiles tool:\n${repoMap.join("\n")}`,
				};
			}
		}
	}

	loadLanguage(ext) {
		switch (ext) {
			case ".js":
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

	extractSymbols(tree, lang) {
		const kinds = {
			// common JS/CPP
			program: "program",
			function_declaration: "function",
			method_definition: "method",
			function_definition: "function",
			class_declaration: "class",
			class_definition: "class",
			struct_specifier: "struct",
			variable_declarator: "variable", // for const/let function assignments
			lexical_declaration: "variable", // for const/let declarations
			export_statement: "export", // for export statements
		};

		const symbols = [];
		const cursor = tree.walk();

		function traverse(depth = 0, parentSymbol = null) {
			const node = cursor.currentNode;
			const kind = kinds[node.type];

			if (kind && kind !== "program") {
				let idNode = node.childForFieldName?.("name");
				let actualNode = node;
				let symbolKind = kind;

				// Handle export statements
				if (node.type === "export_statement") {
					if (depth === 1) {
						// Look for the actual declaration inside the export
						const declaration = node.childForFieldName("declaration");
						if (declaration) {
							if (declaration.type === "function_declaration") {
								idNode = declaration.childForFieldName("name");
								actualNode = node; // Use the export statement as the actual node
								symbolKind = "function";
							} else if (declaration.type === "class_declaration") {
								idNode = declaration.childForFieldName("name");
								actualNode = node;
								symbolKind = "class";
							} else if (
								declaration.type === "lexical_declaration" ||
								declaration.type === "variable_declaration"
							) {
								const declarator = declaration.descendantsOfType(
									"variable_declarator",
								)[0];
								if (declarator) {
									idNode = declarator.childForFieldName("name");
									actualNode = node;
									symbolKind = "variable";
								}
							}

							if (idNode) {
								const sig = actualNode.text.split("\n")[0].slice(0, 120);
								const symbol = {
									name: idNode.text,
									kind: symbolKind,
									signature: sig,
									line: actualNode.startPosition.row + 1,
								};
								symbols.push(symbol);
							}
						}
					}
					return; // Don't traverse children of export statements
				}

				// For variable declarations, we need to dig deeper to find the actual identifier
				if (
					node.type === "lexical_declaration" ||
					node.type === "variable_declaration"
				) {
					// Only process variables if they're at the top level (depth 1, since program is depth 0)
					if (depth === 1) {
						const declarator = node.descendantsOfType("variable_declarator")[0];
						if (declarator) {
							idNode = declarator.childForFieldName("name");
							actualNode = declarator;

							if (idNode) {
								// grab the first line of the signature
								const sig = actualNode.text.split("\n")[0].slice(0, 120);
								symbols.push({
									name: idNode.text,
									kind,
									signature: sig,
									line: actualNode.startPosition.row + 1,
								});
							}
						}
					}
					// Skip processing children for variable declarations
					return;
				}

				// Handle method definitions inside classes
				if (
					node.type === "method_definition" &&
					parentSymbol &&
					parentSymbol.kind === "class"
				) {
					idNode = node.childForFieldName("name");
					if (idNode) {
						const sig = node.text.split("\n")[0].slice(0, 120);
						const methodSymbol = {
							name: idNode.text,
							kind: "method",
							signature: sig,
							line: node.startPosition.row + 1,
							parentClass: parentSymbol.name,
						};
						symbols.push(methodSymbol);
					}
					return; // Don't traverse deeper into methods
				}

				// For non-variable declarations, only process if at top level
				if (depth === 1) {
					if (!idNode) {
						idNode = node.namedChild(0);
					}

					if (idNode) {
						// grab the first line of the signature
						const sig = actualNode.text.split("\n")[0].slice(0, 120);
						const symbol = {
							name: idNode.text,
							kind,
							signature: sig,
							line: actualNode.startPosition.row + 1,
						};
						symbols.push(symbol);

						// For classes, we need to traverse their children to find methods
						if (kind === "class") {
							// Visit children, incrementing depth
							if (cursor.gotoFirstChild()) {
								do {
									traverse(depth + 1, symbol);
								} while (cursor.gotoNextSibling());
								cursor.gotoParent();
							}
							return; // Already handled children
						}
					}
				}
			}

			// Visit children, incrementing depth (for non-class nodes)
			if (cursor.gotoFirstChild()) {
				do {
					traverse(depth + 1, parentSymbol);
				} while (cursor.gotoNextSibling());
				cursor.gotoParent();
			}
		}

		traverse();
		return symbols;
	}

	formatFileOutput(filePath, code, symbols) {
		// Split the code into lines
		const lines = code.split("\n");

		// Helper function to check if a line is a comment or empty
		const isCommentOrEmpty = (line) => {
			const trimmed = line.trim();
			return (
				trimmed.startsWith("//") ||
				trimmed.startsWith("*") ||
				trimmed.startsWith("/**") ||
				trimmed.startsWith("*/") ||
				trimmed === ""
			);
		};

		// Find the actual declaration line for each symbol (skip JSDoc)
		const processedSymbols = symbols.map((symbol) => {
			let actualLine = symbol.line - 1; // Convert to 0-based

			// Look for the actual declaration line (skip backwards through comments)
			while (actualLine >= 0 && isCommentOrEmpty(lines[actualLine])) {
				actualLine--; // Decrement to move backwards through the file
			}

			// Look forward to find the actual declaration if we went too far back
			while (actualLine < lines.length && isCommentOrEmpty(lines[actualLine])) {
				actualLine++;
			}

			return { ...symbol, actualLine };
		});

		// Create a set of important lines - only the first line of each function
		const importantLines = new Set();

		processedSymbols.forEach((symbol) => {
			const startLine = symbol.actualLine;

			// Add only the actual declaration line (first line of the function)
			importantLines.add(startLine);
		});

		// Sort important lines for easier processing
		const sortedImportantLines = Array.from(importantLines).sort(
			(a, b) => a - b,
		);

		// Generate the formatted output
		let output = `${filePath}:\n`;
		let lastOutputLine = -1;

		for (const lineIndex of sortedImportantLines) {
			output += `- ${lines[lineIndex].trim()}\n`;
			lastOutputLine = lineIndex;
		}

		return output;
	}
}
