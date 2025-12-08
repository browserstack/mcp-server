// src/repo/repo-setup.ts

import { GitHubRepositoryFetcher } from "./GitHubRepositoryFetcher.js";
import { RemoteIndexer } from "./RemoteIndexer.js";
import { createFetchFromRepoTool } from "../tools/fetch-from-repo.js";
import { createDesignRepoContextResource } from "../resources/design-repo-context.js";

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export async function setupRemoteRepoMCP(config: RepoConfig) {
  const fetcher = new GitHubRepositoryFetcher(
    config.owner,
    config.repo,
    config.branch,
    config.token,
  );

  const indexer = new RemoteIndexer(fetcher);
  await indexer.buildIndex(); // build repo map

  const fetchFromRepoTool = createFetchFromRepoTool(indexer, fetcher);
  const contextResource = createDesignRepoContextResource(indexer, fetcher);

  return { fetchFromRepoTool, contextResource, indexer };
}
