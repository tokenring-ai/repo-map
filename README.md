# @token-ring/repo-map

The `@token-ring/repo-map` package provides utilities to:
- Generate a concise "repository map" from source files using Tree-sitter parsing, suitable for injecting into an AI chat context as memory.
- Manipulate code symbols (functions, classes, variables, methods, etc.) programmatically via a tool.
- Expose a chat command (`/repo-map`) to print the repository map within the chat UI.

It integrates with the Token Ring registry/services ecosystem and the Filesystem package to locate and read files.

## What is a Repository Map?
A repository map is a compact, human-readable snapshot of important code symbols across selected files. It does not include full file contents; instead, it lists file paths and a few key lines (e.g., top-level declarations) to provide quick structure awareness and pointers to where details can be retrieved when needed.

## Core Exports
- `RepoMapService`: Scans configured files and emits a memory payload containing the repository map.
- `RepoMapResource`: Configures which files/directories should be considered for the map.
- `chatCommands`: Includes the `/repo-map` command to print the current repository map.
- `tools`: Includes the `symbol` tool for creating/replacing/deleting symbols within source files.

Package metadata is also exported via `name`, `description`, and `version` in `index.ts`.

## Components

### RepoMapResource
Configures inputs for the map by extending `@token-ring/filesystem`'s `FileMatchResource`.

Constructor parameters:
- `baseDirectory` (string, required): Root folder from which paths are resolved.
- `items` (array, optional): List of objects describing inputs.
  - `path` (string, required): A file or directory to include.
  - `ignore` (string, optional): .gitignore/glob-style patterns to exclude.

Example:
```ts
import { RepoMapResource } from "@token-ring/repo-map";

const repoMapResource = new RepoMapResource({
  baseDirectory: "/path/to/project",
  items: [
    { path: "src" },
    { path: "pkg", ignore: "**/*.test.*\n**/dist/**" },
  ],
});
```

### RepoMapService
Parses supported files and extracts symbols using Tree-sitter. When invoked, it yields a single memory object like:
```ts
{
  role: "user",
  content: "// These are snippets of the symbols in the project...\n<repo-map>"
}
```
Where `<repo-map>` concatenates entries of the form:
```
relative/file/path.ext:
- function doThing(...) { ...
- class MyClass ...
```

Key points:
- Supported languages for symbol extraction: JavaScript/TypeScript (via tree-sitter-javascript), Python (tree-sitter-python), and C/C++ (tree-sitter-cpp).
- Only relevant lines around symbol declarations are included; not full file contents.
- Uses `FileSystemService` to load file contents and `RepoMapResource` to determine which files to include.

Typical usage via the registry:
```ts
import { ServiceRegistry } from "@token-ring/registry";
import { RepoMapService, RepoMapResource } from "@token-ring/repo-map";

const registry = new ServiceRegistry();
registry.registerService(new RepoMapService());
registry.registerResource(
  new RepoMapResource({ baseDirectory: process.cwd(), items: [{ path: "src" }] })
);

// Consume repository map memories
const repoMapService = registry.requireFirstServiceByType(RepoMapService);
for await (const memory of repoMapService.getMemories(registry)) {
  console.log(memory.content);
}
```

### Chat Command: /repo-map
The package exposes a chat command that prints the map via the chat UI:
- Command: `/repo-map`
- Description: Show the repository map built from `RepoMapResource` inputs.

This is wired through `chatCommands.repoMap` and implemented in `commands/repoMap.ts`.

### Tool: tools.symbol
Create, replace, or delete specific symbols in source code files. Supports:
- symbolType: `function`, `class`, `variable`, `method`, `export`, `constructor`, `property`
- parentClass: for nested edits (e.g., methods inside a class)
- content: complete implementation to insert; an empty string deletes the symbol

Supported file types: `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.c`, `.cpp`, `.h`, `.hpp`, `.hxx`, `.cxx`.

Behavior highlights:
- Fast path for top-level JS/TS functions without needing Tree-sitter (more robust on minimal environments).
- General path uses Tree-sitter for nested symbols and non-JS languages.
- Filesystem writes are handled via `FileSystemService` and changes mark the workspace dirty.

Example invocation:
```ts
import { tools } from "@token-ring/repo-map";
import { ServiceRegistry } from "@token-ring/registry";

const registry = new ServiceRegistry();
// ...register FileSystemService and ChatService...

await tools.symbol.execute(
  {
    path: "src/util/math.js",
    symbolName: "sum",
    symbolType: "function",
    content: "function sum(a, b) { return a + b; }",
  },
  registry
);
```

## Limitations & Notes
- The repository map is intentionally lossy and does not include full file contents.
- Symbol extraction relies on Tree-sitter grammars; only the listed languages are supported.
- The symbol tool manipulates code text; it does not refactor references, imports, or call sites.
- Ensure required services (e.g., `FileSystemService`, `ChatService`) are registered in the registry for commands/tools to function.

## Testing
This package includes Vitest tests (e.g., for `tools/symbol`). From the monorepo root:
```
bun run test
```
Or from this package directory:
```
bun run -C pkg/repo-map test
```

## License
MIT