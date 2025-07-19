import ChatService from "@token-ring/chat/ChatService";
import RepoMapService from "../RepoMapService.js"; // Import RepoMapService

export const description = "/repo-map - Show the repository map.";

export async function execute(remainder, registry) {
	const chatService = registry.requireFirstServiceByType(ChatService);
	// Get the RepoMapService instance from the registry
	const repoMapServiceInstance =
		registry.requireFirstServiceByType(RepoMapService);

	if (!repoMapServiceInstance) {
		chatService.systemLine("Error: RepoMapService not found in the registry.");
		return;
	}

	let found = false;
	// Call getMemories on the RepoMapService instance
	for await (const repoMap of repoMapServiceInstance.getMemories(registry)) {
		found = true;
		chatService.systemLine("Repository map:");
		chatService.systemLine(repoMap.content);
	}

	if (!found) {
		chatService.systemLine(
			"No repository map found. Ensure RepoMapResources are configured.",
		);
	}
}

export function help() {
	return ["/repo-map - Show the repository map"];
}
