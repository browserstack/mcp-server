import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// A build id that is an Automate or App Automate build's own hashed_id (40 hex characters),
// as the SDK prints it at the end of a run, is read as the accessibility build that run made.
// Neither the web nor the app Accessibility API knows such an id, so Automate is asked, then
// App Automate. A probe that can't be answered (anything but a 404) moves on to the next,
// and is named if nothing knows the id; once a session is found, what it says is the answer.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import {
  AccessibilityReportFetcher,
  foundScanRuns,
} from "../../src/tools/accessiblity-utils/report-fetcher.js";

const get = apiClient.get as Mock;

const HASHED = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c"; // the Automate / App Automate build
const SESSION = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
const WEB_BUILD = "q7m2k9x4c1v8b3n6z0w5r2t9y4p1s8d3f6g0h2ja"; // the accessibility build it made
const APP_BUILD = "a9appbuildgggggggggggggggggggggggggggggg";

type Reply = { ok: boolean; status: number; data: unknown };
const reply = (status: number, data: unknown = null): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  data,
});
const notFound = reply(404, { message: "not found" });

/** What each API answers; anything not set is a 404. */
let answers: {
  automateSessions?: Reply;
  appAutomateSessions?: Reply;
  testCode?: Reply;
  native?: Reply;
};

function route({ url }: { url: string }): Reply {
  const path = new URL(url).pathname;
  if (path.endsWith(`/automated-tests/v1/builds/${WEB_BUILD}`)) {
    return reply(200, { success: true, data: { id: WEB_BUILD } });
  }
  if (path === `/automate/builds/${HASHED}/sessions.json`) {
    return answers.automateSessions ?? notFound;
  }
  if (path === `/app-automate/builds/${HASHED}/sessions.json`) {
    return answers.appAutomateSessions ?? notFound;
  }
  if (path.endsWith(`/ext/v1/sessions/${SESSION}/testCode`)) {
    return answers.testCode ?? notFound;
  }
  if (/\/app-automate\/(espresso|xcuitest)\/v2\/builds\//.test(path)) {
    return answers.native ?? notFound;
  }
  // The web and app Accessibility APIs don't know a hashed_id.
  return notFound;
}

const sessions = [{ automation_session: { hashed_id: SESSION } }];
const paths = () => get.mock.calls.map(([o]) => new URL(o.url).pathname);

function fetcher() {
  const f = new AccessibilityReportFetcher();
  f.setAuth({ username: "u", password: "p" });
  return f;
}
const resolve = (buildId: string, orScanRun = true) =>
  fetcher().resolveBuild({ kind: "build", buildId }, { orScanRun });

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (o: { url: string }) => route(o));
  foundScanRuns.clear();
  answers = {};
});

describe("a 40-hex Automate or App Automate build id passed as buildId", () => {
  it("reads an Automate build's id as the accessibility build its sessions ran in", async () => {
    answers.automateSessions = reply(200, sessions);
    answers.testCode = reply(200, { build_uuid: WEB_BUILD });

    await expect(resolve(HASHED)).resolves.toEqual({
      kind: "build",
      buildId: WEB_BUILD,
    });
    expect(paths()).not.toContain(`/app-automate/builds/${HASHED}/sessions.json`);
  });

  it("asks App Automate when Automate does not know the id", async () => {
    answers.appAutomateSessions = reply(200, sessions);
    answers.testCode = reply(200, { build_uuid: APP_BUILD });

    await expect(resolve(HASHED)).resolves.toEqual({
      kind: "appBuild",
      buildId: APP_BUILD,
    });
    expect(paths()).toContain(`/automate/builds/${HASHED}/sessions.json`);
  });

  it.each([
    ["refuses the request (403)", reply(403, { message: "forbidden" })],
    ["fails (500)", reply(500, { message: "boom" })],
    ["lists no sessions for the build", reply(200, [])],
  ])(
    "moves on to App Automate when Automate %s",
    async (_case, automate) => {
      answers.automateSessions = automate;
      answers.appAutomateSessions = reply(200, sessions);
      answers.testCode = reply(200, { build_uuid: APP_BUILD });

      await expect(resolve(HASHED)).resolves.toEqual({
        kind: "appBuild",
        buildId: APP_BUILD,
      });
    },
  );

  it.each([
    ["refuses the request (403)", reply(403, { message: "forbidden" }), "HTTP 403"],
    ["lists no sessions for the build", reply(200, []), "has no sessions"],
  ])(
    "names why Automate could not be asked, when Automate %s and nothing else knows the id",
    async (_case, automate, said) => {
      answers.automateSessions = automate;

      const error = await resolve(HASHED).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain(`No Automated Tests (web) or App Accessibility build with id "${HASHED}"`);
      expect(error.message).toContain("(Automate could not be asked about it: ");
      expect(error.message).toContain(said);
      // A 40-hex id is an Automate id: it is not then sent on as a Website Scanner run's.
      expect(paths().some((p) => p.includes("website-scanner"))).toBe(false);
    },
  );

  it("names an App Automate lookup that failed too", async () => {
    answers.automateSessions = reply(503);
    answers.appAutomateSessions = reply(502);

    const error = await resolve(HASHED, false).catch((e) => e);

    expect(error.message).toContain(`Could not list the sessions of Automate build ${HASHED}: HTTP 503`);
    expect(error.message).toContain(`Could not list the sessions of App Automate build ${HASHED}: HTTP 502`);
  });

  it("takes an id nothing knows as a Website Scanner run's build id when every API answered", async () => {
    await expect(resolve(HASHED)).resolves.toEqual({
      kind: "scanBuild",
      thBuildId: HASHED,
    });
  });

  it("returns what a session that was found says, rather than moving on", async () => {
    answers.automateSessions = reply(200, sessions);
    answers.testCode = reply(200, { build_uuid: undefined });
    answers.appAutomateSessions = reply(200, sessions);

    await expect(resolve(HASHED)).rejects.toThrow(
      `Automate session ${SESSION} is not linked to a BrowserStack SDK build`,
    );
    expect(paths()).not.toContain(`/app-automate/builds/${HASHED}/sessions.json`);
  });

  it("does not ask Automate about an id that is not 40 hex characters", async () => {
    const scannerBuildId = "zz7ocvkf03ilbyscee9azhiqh1q6cgcqbsjhijdm";

    await expect(resolve(scannerBuildId)).resolves.toEqual({
      kind: "scanBuild",
      thBuildId: scannerBuildId,
    });
    expect(paths().some((p) => p.includes("/automate/builds/"))).toBe(false);
  });
});
