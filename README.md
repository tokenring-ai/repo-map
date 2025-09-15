# Repo Map Package Documentation

## Overview

The `@tokenring-ai/repo-map` package is a service designed to generate a lightweight "repository map" for AI agents in the TokenRing AI ecosystem. It analyzes source code files in supported languages (JavaScript, Python, and C/C++) using Tree-sitter parsers to extract key symbols such as functions, classes, methods, variables, and exports. These symbols are formatted into concise snippets that provide contextual awareness of the codebase without including full file contents. This map is yielded as memory messages to agents, enabling them to reference code structure efficiently (e.g., via a `retrieveFiles` tool).

The package integrates with the `FileSystemService` to access files and focuses on top-level declarations. It supports error handling for parsing failures and skips unsupported file types or empty contents. The primary role is to augment agent context for repository analysis, navigation, or code-related queries.

## Installation/Setup

This package is part of the TokenRing AI monorepo. To use it:

1. Ensure the parent project has the necessary dependencies installed via `npm install`.
2. Build the package using the monorepo's build script (e.g., `npm run build` in the root).
3. Register the `RepoMapService` and `RepoMapResource` in your agent's service registry during initialization.

Key dependencies are automatically resolved from `package.json`. No additional runtime setup is required beyond enabling resources.

For standalone testing or development:
- Run `npm install` in the `pkg/repo-map` directory.
- Execute tests with `npm test` (uses Vitest).

## Package Structure

The package follows a standard TypeScript module structure:

- **src/** (implied via exports): Core source files.
  - `RepoMapService.ts`: Main service logic for parsing and symbol extraction.
  - `RepoMapResource.ts`: Resource class for file matching and integration.
  - `index.ts`: Package entry point, exports services and package info.
- **commands/**: Chat command implementations.
  - `repoMap.ts`: Handles the `/repo-map` command to display the map.
- **tools/**: Tool exports (e.g., `symbol.ts` for symbol-related utilities).
- **test/**: Unit tests (e.g., `symbol.test.ts`).
- `package.json`: Defines dependencies, exports, and scripts.
- `tsconfig.json`: TypeScript configuration.
- `README.md`: This documentation.
- `LICENSE`: MIT license.

Directories like `tools/` and `commands/` organize extensible components.

## Core Components

### RepoMapService

The central class implementing `TokenRingService`. It manages resources, parses files, extracts symbols, and generates memory messages.

- **Key Properties/Methods**:
  - `name`: `"RepoMapService"` – Service identifier.
  - `description`: `"Repository map service"` – Brief description.
  - `registerResource(resource: RepoMapResource)`: Registers a resource for file discovery.
  - `getActiveResourceNames()`: Returns names of active resources.
  - `enableResources(names: string[])`: Enables specific resources.
  - `getAvailableResources()`: Lists all registered resources.
  - `async* getMemories(agent: Agent): AsyncGenerator<MemoryItemMessage>`: Yields formatted symbol snippets as user messages. Iterates over active resources to collect files, parses them with Tree-sitter, extracts symbols, and formats output. Skips unsupported languages or errors.

**Symbol Extraction**:
- Uses Tree-sitter for AST traversal via a cursor-based walker.
- Supports node types like `function_declaration`, `class_declaration`, `variable_declarator`, etc.
- Maps to symbol kinds (e.g., "function", "class", "variable").
- Handles nested structures (e.g., methods in classes) and exports.
- Formats signatures (first line, truncated to 120 chars) with line numbers.

**File Formatting** (`formatFileOutput`):
- Filters out comment/empty lines around symbols.
- Outputs file path followed by bulleted important lines.

**Language Support** (`loadLanguage`):
- JavaScript (`.js`): `tree-sitter-javascript`.
- Python (`.py`): `tree-sitter-python`.
- C/C++ (`.c`, `.h`, `.cpp`, etc.): `tree-sitter-cpp`.

Interactions: Resources provide file sets; the service processes them into memories for the agent.

### RepoMapResource

Extends `FileMatchResource` from `@tokenring-ai/filesystem`.

- **Key Properties**:
  - `name`: `"RepoMapResource"`.
  - `description`: `"Provides RepoMap functionality"`.
- **Role**: Matches and adds relevant files to a set for processing by `RepoMapService`. Can be registered and enabled to control which files are analyzed (e.g., glob patterns for source directories).

### Chat Commands

- **/repo-map**: Command to trigger and display the repository map.
  - `execute(remainder: string, agent: Agent)`: Invokes `getMemories` and prints output via `agent.infoLine`.
  - `help()`: Returns command description.

Exported via `chatCommands.ts` for agent integration.

### Tools

- **symbol**: Exported from `tools/symbol.ts` (contents not detailed in analysis, but likely utilities for symbol querying/manipulation).

## Usage Examples

### 1. Registering and Using the Service in an Agent

```typescript
import { Agent } from "@tokenring-ai/agent";
import { RepoMapService, RepoMapResource } from "@tokenring-ai/repo-map";
import { FileSystemService } from "@tokenring-ai/filesystem";

// In agent initialization
const agent = new Agent(/* config */);
const fsService = new FileSystemService(/* fs config */);
agent.registerService(fsService);

const repoMapService = new RepoMapService();
agent.registerService(repoMapService);

// Register and enable a resource (e.g., matching all .ts files)
const resource = new RepoMapResource();
resource.addGlob("**/*.ts"); // Assuming FileMatchResource API
repoMapService.registerResource(resource);
repoMapService.enableResources(["RepoMapResource"]);

// In agent loop or query
for await (const memory of repoMapService.getMemories(agent)) {
  console.log(memory.content); // Outputs formatted symbol map
}
```

### 2. Using the Chat Command

In an interactive agent session:
```
/repo-map
```
Output: Displays the repository map with file paths and symbol lines.

### 3. Custom Resource for Specific Files

```typescript
const customResource = new RepoMapResource();
customResource.addPath("/path/to/specific/file.py");
repoMapService.registerResource(customResource);
repoMapService.enableResources(["CustomResource"]);
```

## Configuration Options

- **Resources**: Register via `registerResource` and enable via `enableResources`. Resources define file globs/paths (inherited from `FileMatchResource`).
- **Supported Languages**: Hardcoded in `loadLanguage`; extend by adding cases and Tree-sitter grammars.
- **Parsing Limits**: Symbols are top-level; signatures truncated to 120 chars. No config for depth, but traversal handles classes/methods.
- **Environment**: Relies on agent's `FileSystemService` for file access. No env vars defined.
- **Error Handling**: Logs errors per file via `agent.errorLine`; continues processing.

## API Reference

- **RepoMapService**:
  - `async* getMemories(agent: Agent): AsyncGenerator<MemoryItemMessage>` – Yields repo map as user content.
  - `loadLanguage(ext: string): Parser.Language | null` – Returns Tree-sitter language by extension.
  - `extractSymbols(tree: SyntaxNode, lang: Language): Symbol[]` – Traverses AST to collect symbols `{name, kind, signature, line, parentClass?}`.
  - `formatFileOutput(file: string, code: string, symbols: Symbol[]): string | null` – Generates bulleted output, skipping comments.

- **RepoMapResource**:
  - Extends `FileMatchResource`: Use `addGlob(pattern)`, `addPath(path)`, etc., to define files.
  - `addFilesToSet(files: Set<string>, agent: Agent)` – Populates file set (inherited/used internally).

- **Commands**:
  - `execute(remainder: string, agent: Agent): Promise<void>` – Runs `/repo-map`.
  - `description: string` – Command help text.

- **Package Exports**:
  - `{ packageInfo: TokenRingPackage }` – Includes `chatCommands` and `tools`.

## Dependencies

- `@tokenring-ai/agent` (^0.1.0): Agent framework and types.
- `@tokenring-ai/filesystem` (^0.1.0): File system access.
- `@tokenring-ai/utility` (implicit via imports): Registry utilities.
- `tree-sitter` (^0.22.4): Core parsing library.
- `tree-sitter-javascript` (^0.23.1): JS parser.
- `tree-sitter-python` (^0.23.6): Python parser.
- `tree-sitter-cpp` (^0.23.4): C/C++ parser.
- `zod` (^4.0.17): Schema validation (unused in core files, possibly for tests/tools).

Dev dependencies: Vitest for testing.

## Contributing/Notes

- **Testing**: Run `npm test` for unit tests (e.g., symbol extraction). Add tests for new languages or edge cases.
- **Building**: Use TypeScript compilation; ESM modules (`type: "module"`).
- **Limitations**: 
  - Only supports JS, Python, C/C++; extend `loadLanguage` for more.
  - Symbol extraction is basic (top-level, no full signatures or types); may miss complex/nested exports.
  - Binary/non-text files skipped; .gitignore respected via FileSystemService.
  - Performance: Parses entire files; suitable for small-to-medium repos.
- **License**: MIT (see LICENSE).
- Contributions: Focus on parser extensions, resource types, or integration improvements. Ensure Tree-sitter compatibility.

For issues or extensions, reference the TokenRing AI codebase.