// src/repo/GitHubRepositoryFetcher.ts

import { Octokit } from "octokit";
import { RepositoryFetcher, RepoFileMeta } from "./RepositoryFetcher.js";

export class GitHubRepositoryFetcher implements RepositoryFetcher {
  private client: Octokit;

  constructor(
    private owner: string,
    private repo: string,
    private branch: string,
    token: string,
  ) {
    this.client = new Octokit({ auth: token });
  }

  async getTree(): Promise<RepoFileMeta[]> {
    const treeRes = await this.client.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: this.branch,
      recursive: "true",
    });

    return treeRes.data.tree.map((item: any) => ({
      path: item.path!,
      sha: item.sha!,
      type: item.type as "blob" | "tree",
      size: item.size,
    }));
  }

  async getFileContent(path: string): Promise<string> {
    const res = await this.client.rest.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
      ref: this.branch,
    });

    if (!("content" in res.data)) {
      throw new Error("Not a file");
    }

    return Buffer.from(res.data.content, "base64").toString("utf8");
  }
}
