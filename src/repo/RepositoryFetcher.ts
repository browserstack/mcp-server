// src/repo/RepositoryFetcher.ts

export interface RepoFileMeta {
  path: string;
  sha: string;
  type: "blob" | "tree";
  size?: number;
}

export interface RepositoryFetcher {
  getTree(): Promise<RepoFileMeta[]>; // indexing
  getFileContent(path: string): Promise<string>; // actual file fetching
}
