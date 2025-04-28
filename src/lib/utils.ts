export function sanitizeUrlParam(param: string): string {
  // Remove any characters that could be used for command injection
  return param.replace(/[;&|`$(){}[\]<>]/g, "");
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
