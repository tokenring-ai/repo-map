import Agent from "@tokenring-ai/agent/Agent";
import RepoMapService from "../RepoMapService.ts";

export const description = "/repo-map - Show the repository map.";

export async function execute(_remainder: string, agent: Agent) {
  const repoMapServiceInstance = agent.requireFirstServiceByType(RepoMapService);

  if (!repoMapServiceInstance) {
    agent.infoLine("Error: RepoMapService not found in the agent.");
    return;
  }

  let found = false;
  for await (const repoMap of repoMapServiceInstance.getMemories(agent)) {
    found = true;
    agent.infoLine("Repository map:");
    agent.infoLine(repoMap.content);
  }

  if (!found) {
    agent.infoLine(
      "No repository map found. Ensure RepoMapResources are configured."
    );
  }
}

// noinspection JSUnusedGlobalSymbols
export function help() {
  return ["/repo-map - Show the repository map"];
}
