import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { retrieveSessionVideo } from "../../src/tools/failurelogs-utils/video";
import { apiClient } from "../../src/lib/apiClient";
import { SessionType } from "../../src/lib/constants";

vi.mock("../../src/lib/apiClient", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../src/lib/get-auth", () => ({
  getBrowserStackAuth: () => "user:key",
}));

const config = {
  "browserstack-username": "user",
  "browserstack-access-key": "key",
};
const VIDEO = "https://automate.browserstack.com/sessions/abc/video?token=t";

describe("retrieveSessionVideo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the recording link for an Automate session", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: { automation_session: { video_url: VIDEO } },
    });

    await expect(
      retrieveSessionVideo("abc", SessionType.Automate, config),
    ).resolves.toBe(`Session video: ${VIDEO}`);

    const call = (apiClient.get as Mock).mock.calls[0][0];
    expect(call.url).toBe(
      "https://api.browserstack.com/automate/sessions/abc.json",
    );
    expect(call.headers.Authorization).toBe(
      `Basic ${Buffer.from("user:key").toString("base64")}`,
    );
  });

  it("targets the App Automate endpoint and encodes the id", async () => {
    (apiClient.get as Mock).mockResolvedValue({
      ok: true,
      status: 200,
      data: { automation_session: { video_url: VIDEO } },
    });

    await retrieveSessionVideo("a/b", SessionType.AppAutomate, config);

    expect((apiClient.get as Mock).mock.calls[0][0].url).toBe(
      "https://api.browserstack.com/app-automate/sessions/a%2Fb.json",
    );
  });

  it("reports a missing session the same way the log fetchers do", async () => {
    (apiClient.get as Mock).mockResolvedValue({ ok: false, status: 404 });

    await expect(
      retrieveSessionVideo("nope", SessionType.Automate, config),
    ).resolves.toBe("No session video available for this session");
  });

  it("reports credential problems without leaking them", async () => {
    (apiClient.get as Mock).mockResolvedValue({ ok: false, status: 401 });

    await expect(
      retrieveSessionVideo("abc", SessionType.Automate, config),
    ).resolves.toMatch(/check your credentials/);
  });

  it.each([
    ["no video_url", { automation_session: { status: "done" } }],
    ["a blank video_url", { automation_session: { video_url: "  " } }],
    ["no session object", {}],
  ])("says no video is available when the payload has %s", async (_l, data) => {
    (apiClient.get as Mock).mockResolvedValue({ ok: true, status: 200, data });

    await expect(
      retrieveSessionVideo("abc", SessionType.Automate, config),
    ).resolves.toBe("No session video available for this session");
  });
});
