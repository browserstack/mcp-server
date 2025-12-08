// src/resources/design-repo-context.ts

import { RemoteIndexer } from "../repo/RemoteIndexer.js";
import { RepositoryFetcher } from "../repo/RepositoryFetcher.js";

export function createDesignRepoContextResource(
  indexer: RemoteIndexer,
  fetcher: RepositoryFetcher,
) {
  return {
    uri: "repo://design-context",
    name: "Design Repository Context",
    description:
      "Provides context from the remote design repository including tokens, components, and documentation",
    mimeType: "text/plain",
    handler: async () => {
      const index = indexer.getIndex();

      // Automatically select relevant files
      const relevantFiles = [...index.keys()].filter((path) =>
        path.match(/(tokens|design|components|docs).*\.(json|md|tsx?|css)$/),
      );

      const parts: string[] = [];

      // Limit for safety and performance
      for (const path of relevantFiles.slice(0, 10)) {
        try {
          const content = await fetcher.getFileContent(path);
          parts.push(`### File: ${path}\n\`\`\`\n${content}\n\`\`\``);
        } catch (error: any) {
          parts.push(`### File: ${path}\nError: ${error.message}`);
        }
      }

      return {
        contents: [
          {
            uri: "repo://design-context",
            mimeType: "text/plain",
            text: `# Client Repository Context\n\n${parts.join("\n\n")}`,
          },
        ],
      };
    },
  };
}
