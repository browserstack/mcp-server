/**
 * Percy API error enrichment module.
 * Maps Percy API error responses to actionable, user-friendly messages.
 */

export class PercyApiError extends Error {
  statusCode: number;
  errorCode?: string;
  body?: unknown;

  constructor(
    message: string,
    statusCode: number,
    errorCode?: string,
    body?: unknown,
  ) {
    super(message);
    this.name = "PercyApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.body = body;
  }
}

/**
 * Maps Percy API error responses to actionable messages.
 * Handles known error codes from Percy's JSON:API responses.
 */
export function enrichPercyError(
  status: number,
  body: unknown,
  context?: string,
): PercyApiError {
  const prefix = context ? `${context}: ` : "";
  const errorBody = body as Record<string, unknown> | undefined;
  const errors = (errorBody?.errors ?? []) as Array<
    Record<string, unknown>
  >;
  const firstError = errors[0];
  const errorCode = (firstError?.code ?? firstError?.source) as
    | string
    | undefined;
  const detail = (firstError?.detail ?? firstError?.title ?? "") as string;

  switch (status) {
    case 401:
      return new PercyApiError(
        `${prefix}Percy token is invalid or expired. Check PERCY_TOKEN environment variable.`,
        401,
        errorCode,
        body,
      );

    case 403: {
      if (errorCode === "project_rbac_access_denied") {
        return new PercyApiError(
          `${prefix}Insufficient permissions. This operation requires write access to the project.`,
          403,
          errorCode,
          body,
        );
      }
      if (errorCode === "build_deleted") {
        return new PercyApiError(
          `${prefix}This build has been deleted.`,
          403,
          errorCode,
          body,
        );
      }
      if (errorCode === "plan_history_exceeded") {
        return new PercyApiError(
          `${prefix}This build is outside your plan's history limit.`,
          403,
          errorCode,
          body,
        );
      }
      return new PercyApiError(
        `${prefix}Forbidden: ${detail || "Access denied."}`,
        403,
        errorCode,
        body,
      );
    }

    case 404:
      return new PercyApiError(
        `${prefix}Resource not found. Check the ID and try again.`,
        404,
        errorCode,
        body,
      );

    case 422:
      return new PercyApiError(
        `${prefix}Invalid request: ${detail || "Unprocessable entity."}`,
        422,
        errorCode,
        body,
      );

    case 429:
      return new PercyApiError(
        `${prefix}Rate limit exceeded. Try again shortly.`,
        429,
        errorCode,
        body,
      );

    default:
      return new PercyApiError(
        `${prefix}Percy API error (${status}): ${detail || "Unknown error"}`,
        status,
        errorCode,
        body,
      );
  }
}
