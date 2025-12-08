// src/repo/RemoteIndexer.ts

import { RepositoryFetcher, RepoFileMeta } from "./RepositoryFetcher.js";

export class RemoteIndexer {
  private index: Map<string, RepoFileMeta> = new Map();

  constructor(private fetcher: RepositoryFetcher) {}

  async buildIndex() {
    const tree = await this.fetcher.getTree();
    tree.forEach((item: RepoFileMeta) => this.index.set(item.path, item));
  }

  getIndex() {
    return this.index;
  }

  fileExists(path: string) {
    return this.index.has(path);
  }
}
