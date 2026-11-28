import { BrowserStackConfig } from "../lib/types.js";
import { CallerError } from "./error.js";

export function getBrowserStackAuth(config: BrowserStackConfig): string {
  const username = config["browserstack-username"];
  const accessKey = config["browserstack-access-key"];
  if (!username || !accessKey) {
    throw new CallerError(
      "BrowserStack credentials not set on server.authHeaders",
    );
  }
  return `${username}:${accessKey}`;
}
