import { describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { errorText, formatAxiosError } from "../../src/lib/error";

const axiosError = (
  status: number,
  data: unknown,
  message = `Request failed with status code ${status}`,
) =>
  Object.assign(Object.create(AxiosError.prototype), {
    message,
    response: { status, data },
  });

describe("errorText", () => {
  it("prefers message, then error, then errors", () => {
    expect(errorText(axiosError(422, { message: "m", error: "e" }), "d")).toBe(
      "m",
    );
    expect(errorText(axiosError(422, { error: "e", errors: ["x"] }), "d")).toBe(
      "e",
    );
    expect(errorText(axiosError(422, { errors: ["x"] }), "d")).toBe('["x"]');
  });

  it("serialises object fields instead of printing [object Object]", () => {
    expect(errorText(axiosError(400, { message: { nested: 1 } }), "d")).toBe(
      '{"nested":1}',
    );
    expect(
      errorText(axiosError(400, { errors: { name: ["is too long"] } }), "d"),
    ).toBe('{"name":["is too long"]}');
  });

  it("uses a plain string body", () => {
    expect(errorText(axiosError(401, "Unauthorized"), "d")).toBe(
      "Unauthorized",
    );
  });

  it("uses the whole body when none of the known fields exist", () => {
    expect(
      errorText(axiosError(400, { detail: { hint: "try low" } }), "d"),
    ).toBe('{"detail":{"hint":"try low"}}');
  });

  it("falls back to the error message on an empty or whitespace body", () => {
    expect(errorText(axiosError(500, ""), "d")).toBe(
      "Request failed with status code 500",
    );
    expect(errorText(axiosError(500, "   \n"), "d")).toBe(
      "Request failed with status code 500",
    );
    expect(errorText(axiosError(500, {}), "d")).toBe(
      "Request failed with status code 500",
    );
    expect(errorText(axiosError(500, { message: "  " }), "d")).toBe(
      "Request failed with status code 500",
    );
    expect(errorText(axiosError(500, undefined), "d")).toBe(
      "Request failed with status code 500",
    );
  });

  it("falls back to the default text when the error has no message either", () => {
    expect(errorText(axiosError(502, "", ""), "Failed to list")).toBe(
      "Failed to list",
    );
  });

  it("ignores an HTML error page and reports the status instead", () => {
    const page =
      "<html><head><title>504 Gateway Time-out</title></head><body>nginx</body></html>";
    expect(errorText(axiosError(504, page), "d")).toBe(
      "Request failed with status code 504",
    );
    expect(
      errorText(axiosError(502, "<!DOCTYPE html><html></html>"), "d"),
    ).toBe("Request failed with status code 502");
  });

  it("caps the surfaced text at 500 characters", () => {
    expect(errorText(axiosError(504, "x".repeat(10000)), "d")).toHaveLength(
      500,
    );
    const big = {
      errors: Array.from({ length: 500 }, (_, i) => `field ${i} is invalid`),
    };
    expect(errorText(axiosError(422, big), "d")).toHaveLength(500);
  });

  it("handles non-axios errors and non-errors", () => {
    expect(errorText(new Error("read ECONNRESET"), "d")).toBe(
      "read ECONNRESET",
    );
    expect(errorText(new Error(""), "d")).toBe("d");
    expect(errorText("boom", "d")).toBe("d");
    expect(errorText(undefined, "d")).toBe("d");
  });
});

describe("formatAxiosError", () => {
  it("wraps errorText in an error result", () => {
    expect(formatAxiosError(axiosError(422, { error: "bad" }), "d")).toEqual({
      content: [{ type: "text", text: "bad" }],
      isError: true,
    });
  });
});
