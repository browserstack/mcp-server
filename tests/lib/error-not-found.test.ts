import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { HttpError, isNotFoundError } from "../../src/lib/error";

describe("isNotFoundError", () => {
  it("reads the status, not the message", () => {
    expect(isNotFoundError(new HttpError("Not Found", 404))).toBe(true);
    expect(isNotFoundError(new HttpError("404 in the text", 500))).toBe(false);
    expect(isNotFoundError(new Error("Failed: 404 Not Found"))).toBe(false);
  });

  it("handles axios errors from apiClient", () => {
    const error = new AxiosError(
      "Request failed",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        status: 404,
        statusText: "Not Found",
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
      },
    );
    expect(isNotFoundError(error)).toBe(true);
  });
});
