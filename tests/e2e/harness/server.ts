/**
 * L3 server under test: the real BrowserStackMcpServer, connected to an MCP Client over
 * InMemoryTransport. No network: MSW answers every HTTP call (see msw.ts).
 *
 * src/config.ts reads env when it loads. So each start does vi.resetModules(), sets the
 * env of the profile, and imports the server again.
 */
import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AccountRegion } from "../../../src/lib/region-context.js";

export type Profile = "local-US" | "remote-US";
export const PROFILES: readonly Profile[] = ["local-US", "remote-US"];

export const E2E_USERNAME = "e2e-user";
/** A case fails if a tool result contains this text. */
export const E2E_ACCESS_KEY = "e2eSECRETkey0001";

/** Env of each profile. Proxy variables are cleared, so no run depends on the host. */
const PROFILE_ENV: Record<Profile, Record<string, string>> = {
  "local-US": { REMOTE_MCP: "false" },
  "remote-US": { REMOTE_MCP: "true" },
};

const CLEARED_ENV = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "DEV_MODE",
  "MCP_UPLOAD_BASE_DIR",
  "BROWSERSTACK_AUTOMATION_BASE_URL",
  "O11Y_TFA_RCA_BASE_URL",
  "BROWSERSTACK_O11Y_UI_BASE_URL",
  "ASK_BROWSERSTACK_DISABLED",
  "ASK_BROWSERSTACK_ATLAS_URL",
  "ASK_BROWSERSTACK_AUTH_TOKEN_URL",
  "ASK_BROWSERSTACK_RELAY_TRANSPORT",
];

export interface StartedServer {
  client: Client;
  close: () => Promise<void>;
}

export interface StartOptions {
  profile: Profile;
  /** The account region the server sees. Default: US. */
  region?: AccountRegion;
}

export async function startServer({
  profile,
  region = "us",
}: StartOptions): Promise<StartedServer> {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const name of CLEARED_ENV) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(PROFILE_ENV[profile])) {
    vi.stubEnv(name, value);
  }
  // tests/setup.ts mocks the lookup to undefined (= US). Here the region is explicit.
  vi.doMock("../../../src/lib/account-region.js", () => ({
    accountRegion: async () => region,
  }));

  const { BrowserStackMcpServer } =
    await import("../../../src/server-factory.js");
  const bs = new BrowserStackMcpServer({
    "browserstack-username": E2E_USERNAME,
    "browserstack-access-key": E2E_ACCESS_KEY,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "l3-e2e", version: "1.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    client.connect(clientTransport),
    bs.getInstance().connect(serverTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      vi.doUnmock("../../../src/lib/account-region.js");
    },
  };
}
