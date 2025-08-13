import {Registry, Service} from "@token-ring/registry";
import path from "path";
import Parser from "tree-sitter";
import JS from "tree-sitter-javascript";
import CPP from "tree-sitter-cpp";
import Python from "tree-sitter-python";
import {FileSystemService} from "@token-ring/filesystem";
import RepoMapResource from "./RepoMapResource.ts";

export type Memory = { role: string; content: string };

export default class RepoMapService extends Service {
  /**
   * Asynchronously yields memories from a repo map
   * @param {any} registry - The registry object containing available services
   */
  async *getMemories(registry: Registry): AsyncGenerator<Memory> {
    const fileSystem = registry.requireFirstServiceByType(FileSystemService);

    const files = new Set<string>();

    const resources = registry.resources.getResourcesByType(RepoMapResource);
    for (const resource of resources) {
      await resource.addFilesToSet(files, registry);
    }

    if (files.size > 0) {
      const repoMap: string[] = [];
      for (const file of files) {
        try {
          const lang = this.loadLanguage(path.extname(file));
          if (!lang) {
            continue;
          }
          const parser: any = new (Parser as any)();
          parser.setLanguage(lang);
          const code = await fileSystem.getFile(file);
          if (code === null || code === undefined) {
            console.error(
              `[RepoMapService] Error: Could not read content for file ${file}. Skipping.`
            );
            continue;
          }
          const tree = parser.parse(code);
          const symbols = this.extractSymbols(tree, lang);

          const formattedOutput = this.formatFileOutput(file, code, symbols);
          if (formattedOutput) repoMap.push(formattedOutput);
        } catch (error) {
          console.error(
            `[RepoMapService] Error processing file ${file}:`,
            error
          );
        }
      }

      if (repoMap.length > 0) {
        yield {
          role: "user",
          content: `// These are snippets of the symbols in the project. This DOES NOT contain the full file contents. This only includes relevant symbols for you to reference so you know what to retrieve with the retrieveFiles tool:\n${repoMap.join(
            "\n"
          )}`,
        };
      }
    }
  }

  loadLanguage(ext: string): any | null {
    switch (ext) {
      case ".js":
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

  extractSymbols(tree: any, _lang: any) {
    const kinds: Record<string, string> = {
      program: "program",
      function_declaration: "function",
      method_definition: "method",
      function_definition: "function",
      class_declaration: "class",
      class_definition: "class",
      struct_specifier: "struct",
      variable_declarator: "variable",
      lexical_declaration: "variable",
      export_statement: "export",
    };

    const symbols: any[] = [];
    const cursor = tree.walk();

    const traverse = (depth = 0, parentSymbol: any = null) => {
      const node = cursor.currentNode;
      const kind = kinds[node.type];

      if (kind && kind !== "program") {
        let idNode = node.childForFieldName?.("name");
        let actualNode = node;
        let symbolKind = kind;

        if (node.type === "export_statement") {
          if (depth === 1) {
            const declaration = node.childForFieldName("declaration");
            if (declaration) {
              if (declaration.type === "function_declaration") {
                idNode = declaration.childForFieldName("name");
                actualNode = node;
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
                  "variable_declarator"
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
          return;
        }

        if (
          node.type === "lexical_declaration" ||
          node.type === "variable_declaration"
        ) {
          if (depth === 1) {
            const declarator = node.descendantsOfType("variable_declarator")[0];
            if (declarator) {
              idNode = declarator.childForFieldName("name");
              actualNode = declarator;

              if (idNode) {
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
          return;
        }

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
          return;
        }

        if (depth === 1) {
          if (!idNode) {
            idNode = node.namedChild(0);
          }

          if (idNode) {
            const sig = actualNode.text.split("\n")[0].slice(0, 120);
            const symbol = {
              name: idNode.text,
              kind,
              signature: sig,
              line: actualNode.startPosition.row + 1,
            };
            symbols.push(symbol);

            if (kind === "class") {
              if (cursor.gotoFirstChild()) {
                do {
                  traverse(depth + 1, symbol);
                } while (cursor.gotoNextSibling());
                cursor.gotoParent();
              }
              return;
            }
          }
        }
      }

      if (cursor.gotoFirstChild()) {
        do {
          traverse(depth + 1, parentSymbol);
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    traverse();
    return symbols;
  }

  formatFileOutput(filePath: string, code: string, symbols: any[]) {
    const lines = code.split("\n");

    const isCommentOrEmpty = (line: string) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/**") ||
        trimmed.startsWith("*/") ||
        trimmed === ""
      );
    };

    const processedSymbols = symbols.map((symbol) => {
      let actualLine = symbol.line - 1;

      while (actualLine >= 0 && isCommentOrEmpty(lines[actualLine])) {
        actualLine--;
      }

      while (actualLine < lines.length && isCommentOrEmpty(lines[actualLine])) {
        actualLine++;
      }

      return { ...symbol, actualLine };
    });

    const importantLines = new Set<number>();

    processedSymbols.forEach((symbol) => {
      const startLine = symbol.actualLine;
      importantLines.add(startLine);
    });

    const sortedImportantLines = Array.from(importantLines).sort((a, b) => a - b);

    let output = `${filePath}:\n`;

    for (const lineIndex of sortedImportantLines) {
      output += `- ${lines[lineIndex].trim()}\n`;
    }

    return output;
  }
}
