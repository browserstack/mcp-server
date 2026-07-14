import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);

async function runCli(args: string[]) {
  const env = { ...process.env };
  delete env.BROWSERSTACK_USERNAME;
  delete env.BROWSERSTACK_ACCESS_KEY;
  delete env.npm_config_npm_globalconfig;
  delete env.npm_config_verify_deps_before_run;
  delete env.npm_config__jsr_registry;

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/index.ts", ...args],
      { cwd: root, env },
    );
    return { code: 0, stdout, stderr };
  } catch (error: any) {
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

describe("CLI metadata flags", () => {
  it("prints the package version without requiring credentials", async () => {
    const result = await runCli(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stderr).not.toContain("BROWSERSTACK_USERNAME");
  });

  it("prints help without requiring credentials", async () => {
    const result = await runCli(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("BrowserStack MCP Server");
    expect(result.stderr).not.toContain("BROWSERSTACK_USERNAME");
  });
});
