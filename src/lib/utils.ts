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
    headers?: { name: string; value: string }[];
    queryString?: { name: string; value: string }[];
  };
  response: {
    status: number;
    statusText?: string;
    _error?: string;
    headers?: { name: string; value: string }[];
    content?: {
      size?: number;
      mimeType?: string;
      comment?: string;
    };
  };
  serverIPAddress?: string;
  time?: number;
}
