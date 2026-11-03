import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import httpsProxyAgentPkg from "https-proxy-agent";
const { HttpsProxyAgent } = httpsProxyAgentPkg;
import * as https from "https";
import * as fs from "fs";
import config from "../config.js";
import { isDataUrlPayloadTooLarge } from "../lib/utils.js";

type RequestOptions = {
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  body?: any;
  timeout?: number;
  responseType?: AxiosRequestConfig["responseType"];
  maxContentLength?: number;
  raise_error?: boolean; // default: true
};

class ApiResponse<T = any> {
  private _response: AxiosResponse<T>;

  constructor(response: AxiosResponse<T>) {
    this._response = response;
  }

  get data(): T {
    return this._response.data;
  }

  get status(): number {
    return this._response.status;
  }

  get statusText(): string {
    return this._response.statusText;
  }

  get headers(): Record<string, string> {
    const raw = this._response.headers;
    const sanitized: Record<string, string> = {};

    for (const key in raw) {
      const value = raw[key];
      if (typeof value === "string") {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  get config(): AxiosRequestConfig {
    return this._response.config;
  }

  get url(): string | undefined {
    return this._response.config.url;
  }

  get ok(): boolean {
    return this._response.status >= 200 && this._response.status < 300;
  }
}

/**
 * How long a connection gives each of a host's addresses before trying the next. Node's own
 * default is 250 ms: on a slow route the IPv4 attempt is dropped that early and the IPv6 one
 * fails where there is no IPv6 route, so the call fails with "connect ETIMEDOUT <IPv4>;
 * connect ENETUNREACH <IPv6>" within a second. The hosted server saw exactly that.
 */
export const CONNECT_ATTEMPT_TIMEOUT_MS = 2000;

// Shared, so connections are reused as they are on Node's own global agent.
const directAgent = new https.Agent({
  keepAlive: true,
  autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_TIMEOUT_MS,
});

/** Failures to open the connection at all: nothing was sent, so a request can be repeated. */
const CONNECT_FAILURE =
  /\bconnect (ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED)\b/;
const CONNECT_FAILURE_CODES = new Set([
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
]);

export function isConnectFailure(error: any): boolean {
  if (!error || error.response) return false;
  const causes = [error, error.cause, ...(error.errors ?? [])].filter(Boolean);
  return causes.some(
    (cause: any) =>
      (cause.syscall === "connect" && CONNECT_FAILURE_CODES.has(cause.code)) ||
      CONNECT_FAILURE.test(String(cause.message ?? "")),
  );
}

// Utility to create HTTPS agent if needed (proxy/CA)
function getAxiosAgent(): AxiosRequestConfig["httpsAgent"] | undefined {
  const proxyHost = config.browserstackLocalOptions.proxyHost;
  const proxyPort = config.browserstackLocalOptions.proxyPort;
  const caCertPath = config.browserstackLocalOptions.useCaCertificate;

  // If both proxy host and port are defined
  if (proxyHost && proxyPort) {
    const proxyUrl = `http://${proxyHost}:${proxyPort}`;
    if (caCertPath && fs.existsSync(caCertPath)) {
      // Proxy + CA cert
      const ca = fs.readFileSync(caCertPath);
      return new HttpsProxyAgent({
        host: proxyHost,
        port: Number(proxyPort),
        ca,
      });
    } else {
      // Proxy only
      return new HttpsProxyAgent(proxyUrl);
    }
  } else if (caCertPath && fs.existsSync(caCertPath)) {
    // CA only
    return new https.Agent({
      ca: fs.readFileSync(caCertPath),
      autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_TIMEOUT_MS,
    });
  }
  // Default agent (no proxy, no CA)
  return directAgent;
}

class ApiClient {
  private instance = axios.create();

  private get axiosAgent() {
    return getAxiosAgent();
  }

  private validateUrl(url: string, options?: AxiosRequestConfig) {
    try {
      const parsedUrl = new URL(url);

      // Default safe limits
      const maxContentLength = options?.maxContentLength ?? 20 * 1024 * 1024; // 20MB
      const maxBodyLength = options?.maxBodyLength ?? 20 * 1024 * 1024; // 20MB
      const maxUrlLength = 8000; // cutoff for URLs

      // Check overall URL length
      if (url.length > maxUrlLength) {
        throw new Error(
          `URL length exceeds maxUrlLength (${maxUrlLength} chars)`,
        );
      }

      if (parsedUrl.protocol === "data:") {
        // Either reject completely OR check payload size
        if (isDataUrlPayloadTooLarge(url, maxContentLength)) {
          throw new Error("data: URI payload too large or invalid");
        }
      } else if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error(`Unsupported URL scheme: ${parsedUrl.protocol}`);
      }

      if (
        options?.data &&
        Buffer.byteLength(JSON.stringify(options.data), "utf8") > maxBodyLength
      ) {
        throw new Error(
          `Request body exceeds maxBodyLength (${maxBodyLength} bytes)`,
        );
      }
    } catch (error: any) {
      throw new Error(`Invalid URL: ${error.message}`);
    }
  }

  private async requestWrapper<T>(
    fn: (agent: AxiosRequestConfig["httpsAgent"]) => Promise<AxiosResponse<T>>,
    url: string,
    config?: AxiosRequestConfig,
    raise_error: boolean = true,
  ): Promise<ApiResponse<T>> {
    try {
      this.validateUrl(url, config);

      let res: AxiosResponse<T>;
      try {
        res = await fn(this.axiosAgent);
      } catch (error: any) {
        // A connection that never opened sent nothing, so one more try is safe even for a
        // POST; a second failure is reported as before.
        if (!isConnectFailure(error)) throw error;
        res = await fn(this.axiosAgent);
      }
      return new ApiResponse<T>(res);
    } catch (error: any) {
      if (error.response && !raise_error) {
        return new ApiResponse<T>(error.response);
      }
      if (!raise_error && /maxContentLength/.test(error.message ?? "")) {
        return new ApiResponse<T>({
          status: 413,
          statusText: "Payload Too Large",
        } as AxiosResponse<T>);
      }
      throw error;
    }
  }

  async get<T = any>({
    url,
    headers,
    params,
    timeout,
    responseType,
    maxContentLength,
    raise_error = true,
  }: RequestOptions): Promise<ApiResponse<T>> {
    const config: AxiosRequestConfig = {
      headers,
      params,
      timeout,
      responseType,
      maxContentLength,
      httpsAgent: this.axiosAgent,
    };
    return this.requestWrapper<T>(
      () => this.instance.get<T>(url, config),
      url,
      config,
      raise_error,
    );
  }

  async post<T = any>({
    url,
    headers,
    body,
    timeout,
    raise_error = true,
  }: RequestOptions): Promise<ApiResponse<T>> {
    const config: AxiosRequestConfig = {
      headers,
      timeout,
      httpsAgent: this.axiosAgent,
      data: body,
    };
    return this.requestWrapper<T>(
      () => this.instance.post<T>(url, config.data, config),
      url,
      config,
      raise_error,
    );
  }

  async put<T = any>({
    url,
    headers,
    body,
    timeout,
    raise_error = true,
  }: RequestOptions): Promise<ApiResponse<T>> {
    const config: AxiosRequestConfig = {
      headers,
      timeout,
      httpsAgent: this.axiosAgent,
      data: body,
    };
    return this.requestWrapper<T>(
      () => this.instance.put<T>(url, config.data, config),
      url,
      config,
      raise_error,
    );
  }

  async patch<T = any>({
    url,
    headers,
    body,
    timeout,
    raise_error = true,
  }: RequestOptions): Promise<ApiResponse<T>> {
    const config: AxiosRequestConfig = {
      headers,
      timeout,
      httpsAgent: this.axiosAgent,
      data: body,
    };
    return this.requestWrapper<T>(
      () => this.instance.patch<T>(url, config.data, config),
      url,
      config,
      raise_error,
    );
  }

  async delete<T = any>({
    url,
    headers,
    params,
    timeout,
    raise_error = true,
  }: RequestOptions): Promise<ApiResponse<T>> {
    const config: AxiosRequestConfig = {
      headers,
      params,
      timeout,
      httpsAgent: this.axiosAgent,
    };
    return this.requestWrapper<T>(
      () => this.instance.delete<T>(url, config),
      url,
      config,
      raise_error,
    );
  }
}

export const apiClient = new ApiClient();
export type { ApiResponse, RequestOptions };
