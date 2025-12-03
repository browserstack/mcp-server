// src/tools/fetch-from-repo.ts

import { z } from "zod";
import { RemoteIndexer } from "../repo/RemoteIndexer.js";
import { RepositoryFetcher } from "../repo/RepositoryFetcher.js";

export function createFetchFromRepoTool(
  indexer: RemoteIndexer,
  fetcher: RepositoryFetcher,
) {
  return {
    name: "fetchFromRepo",
    description: "Fetch a file from a remote repository that has been indexed",
    inputSchema: z.object({
      path: z.string().describe("The file path in the repository"),
    }),
    handler: async ({ path }: { path: string }) => {
      if (!indexer.fileExists(path)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: File not found in index: ${path}`,
            },
          ],
        };
      }
      try {
        const content = await fetcher.getFileContent(path);
        return {
          content: [
            {
              type: "text" as const,
              text: `File: ${path}\n\n${content}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching file: ${error.message}`,
            },
          ],
        };
      }
    },
  };
}
