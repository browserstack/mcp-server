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

export function createCustomInitializeHandler(
  origHandler: (request: any, extra: any) => Promise<any>,
  logger: any,
  setClientName: (name: string) => void,
) {
  return async function (this: any, request: any, extra: any) {
    const clientInfo = request.params.clientInfo;
    if (clientInfo && clientInfo.name) {
      setClientName(clientInfo.name);
      logger.info(
        `Client connected: ${clientInfo.name} (version: ${clientInfo.version})`,
      );
    } else {
      logger.info("Client connected: unknown client");
    }
    return origHandler.call(this, request, extra);
  };
}
