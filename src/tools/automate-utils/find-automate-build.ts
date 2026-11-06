import { apiClient } from "../../lib/apiClient.js";
import { SessionType } from "../../lib/constants.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getRegionalHost } from "../../lib/regional-host.js";

export interface AutomateBuildMatch {
  hashedBuildId: string;
  sessionType: SessionType;
  name: string;
}

// One page per product: clients retry failed lookups.
const PAGE_SIZE = 100;
const MAX_PAGES = 1;

function buildsUrl(sessionType: SessionType): string {
  return sessionType === SessionType.Automate
    ? `${getRegionalHost("automateApi")}/automate/builds.json`
    : `${getRegionalHost("appAutomateCloud")}/app-automate/builds.json`;
}

const normalise = (value: string) => value.trim().toLowerCase();

export async function findAutomateBuildsByName(
  buildName: string,
  config: BrowserStackConfig,
): Promise<AutomateBuildMatch[]> {
  const wanted = normalise(buildName);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(getBrowserStackAuth(config)).toString("base64")}`,
  };

  const searchProduct = async (sessionType: SessionType) => {
    const matches: AutomateBuildMatch[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await apiClient
        .get({
          url: buildsUrl(sessionType),
          headers,
          params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
          raise_error: false,
        })
        .catch(() => undefined);
      if (!response?.ok || !Array.isArray(response.data)) break;
      for (const item of response.data) {
        const build = item?.automation_build;
        if (
          typeof build?.hashed_id === "string" &&
          typeof build?.name === "string" &&
          normalise(build.name) === wanted
        ) {
          matches.push({
            hashedBuildId: build.hashed_id,
            sessionType,
            name: build.name,
          });
        }
      }
      if (response.data.length < PAGE_SIZE) break;
    }
    return matches;
  };

  const products = [SessionType.Automate, SessionType.AppAutomate];
  return (await Promise.all(products.map(searchProduct))).flat();
}
