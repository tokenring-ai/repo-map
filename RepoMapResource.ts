import { FileMatchResource } from "@token-ring/filesystem";

export interface RepoMapItem {
  path: string;
  ignore?: string;
}

export interface RepoMapResourceParams {
  baseDirectory: string;
  items?: RepoMapItem[];
}

export default class RepoMapResource extends FileMatchResource {
  name = "RepoMapResource";
  description = "Provides RepoMap functionality";
  static constructorProperties = {
    baseDirectory: {
      type: "string",
      required: true,
      description: "Base directory for the RepoMapResource",
    },
    items: {
      type: "array",
      description: "Files to insert into the chat memory",
      items: {
        type: "object",
        properties: {
          path: {
            type: "string",
            required: true,
            description:
              "Path to directory or file to insert into the chat memory",
          },
          ignore: {
            type: "string",
            description:
              "A .gitignore/node-glob ignore style list of files to ignore",
          },
        },
      },
    },
  } as const;

  constructor(params: RepoMapResourceParams) {
    super(params as any);
  }
}
