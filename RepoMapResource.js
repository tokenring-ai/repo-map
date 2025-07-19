import {FileMatchResource} from "@token-ring/filesystem";

export default class RepoMapResource extends FileMatchResource {
 name = "RepoMapResource";
 description = "Provides RepoMap functionality";
 static constructorProperties = {
  baseDirectory: {
   type: "string",
   required: true,
   description: "Base directory for the RepoMapResource"
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
      description: "Path to directory or file to insert into the chat memory"
     },
     ignore: {
      type: "string",
      description: "A .gitignore/node-glob ignore style list of files to ignore"
     },
    }
   }
  },
 };


 /**
  * Create a WholeFileResource instance.
  * @param {Object} params
  * @param {Array} params.items - Files to insert into the chat memory.
  */
 constructor(params) {
  super(params);
 }
}