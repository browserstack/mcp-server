export interface LogResponse {
  logs?: any[];
  message?: string;
}

export interface HarFile {
  log: {
    entries: HarEntry[];
  };
}

export interface HarEntry {
  startedDateTime: string;
  request: {
    method: string;
    url: string;
    queryString?: { name: string; value: string }[];
  };
  response: {
    status: number;
    statusText?: string;
    _error?: string;
  };
  serverIPAddress?: string;
  time?: number;
}

export function validateLogResponse(
  response: Response,
  logType: string,
): LogResponse | null {
  if (!response.ok) {
    if (response.status === 404) {
      return { message: `No ${logType} available for this session` };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        message: `Unable to access ${logType} - please check your credentials`,
      };
    }
    return { message: `Unable to fetch ${logType} at this time` };
  }
  return null;
}

export function filterLinesByKeywords(
  logText: string,
  keywords: string[],
): string[] {
  return logText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      keywords.some((keyword) => line.toLowerCase().includes(keyword)),
    );
}
