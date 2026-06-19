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
    });
  }
  // Default agent (no proxy, no CA)
  return undefined;
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

      const res = await fn(this.axiosAgent);
      return new ApiResponse<T>(res);
    } catch (error: any) {
      if (error.response && !raise_error) {
        return new ApiResponse<T>(error.response);
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
    raise_error = true,
  }: RequestOptions): Promise<ApiResponse<T>> {
    const config: AxiosRequestConfig = {
      headers,
      params,
      timeout,
      responseType,
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
