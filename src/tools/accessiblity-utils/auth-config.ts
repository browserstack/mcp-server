import { apiClient } from "../../lib/apiClient.js";
import logger from "../../logger.js";
import { getA11yBaseURL } from "../../lib/a11y-base-url.js";
import { BrowserStackConfig } from "../../lib/types.js";

export interface AuthConfigResponse {
  success: boolean;
  data?: {
    id: number;
    name: string;
    type: string;
    username?: string;
    password?: string;
    url?: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
  };
  errors?: string[];
}

export interface FormAuthData {
  username: string;
  usernameSelector: string;
  password: string;
  passwordSelector: string;
  submitSelector: string;
  url: string;
}

export interface BasicAuthData {
  url: string;
  username: string;
  password: string;
}

export class AccessibilityAuthConfig {
  private auth: { username: string; password: string } | undefined;
  private config: BrowserStackConfig;

  constructor(config: BrowserStackConfig) {
    this.config = config;
  }

  public setAuth(auth: { username: string; password: string }): void {
    this.auth = auth;
  }

  private transformLocalUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const localHosts = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);
      const BS_LOCAL_DOMAIN = "bs-local.com";

      if (localHosts.has(parsed.hostname)) {
        parsed.hostname = BS_LOCAL_DOMAIN;
        return parsed.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  async createFormAuthConfig(
    name: string,
    authData: FormAuthData,
  ): Promise<AuthConfigResponse> {
    if (!this.auth?.username || !this.auth?.password) {
      throw new Error(
        "BrowserStack credentials are not set for AccessibilityAuthConfig.",
      );
    }

    const transformedAuthData = {
      ...authData,
      url: this.transformLocalUrl(authData.url),
    };

    const requestBody = {
      name,
      type: "form",
      authData: transformedAuthData,
    };

    try {
      const response = await apiClient.post<AuthConfigResponse>({
        url: "https://api-accessibility.browserstack.com/api/website-scanner/v1/auth_configs",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.auth.username}:${this.auth.password}`).toString(
              "base64",
            ),
          "Content-Type": "application/json",
        },
        body: requestBody,
      });

      const data = response.data;
      logger.info(`The data returned from the API is: ${JSON.stringify(data)}`);
      if (!data.success) {
        throw new Error(
          `Unable to create auth config: ${data.errors?.join(", ")}`,
        );
      }
      return data;
    } catch (err: any) {
      logger.error(
        `Error creating form auth config: ${JSON.stringify(err?.response?.data)}`,
      );
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        String(err);
      throw new Error(`Failed to create form auth config: ${msg}`);
    }
  }

  async createBasicAuthConfig(
    name: string,
    authData: BasicAuthData,
  ): Promise<AuthConfigResponse> {
    if (!this.auth?.username || !this.auth?.password) {
      throw new Error(
        "BrowserStack credentials are not set for AccessibilityAuthConfig.",
      );
    }

    const transformedAuthData = {
      ...authData,
      url: this.transformLocalUrl(authData.url),
    };

    const requestBody = {
      name,
      type: "basic",
      authData: transformedAuthData,
    };

    try {
      const response = await apiClient.post<AuthConfigResponse>({
        url: "https://api-accessibility.browserstack.com/api/website-scanner/v1/auth_configs",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.auth.username}:${this.auth.password}`).toString(
              "base64",
            ),
          "Content-Type": "application/json",
        },
        body: requestBody,
      });

      const data = response.data;
      if (!data.success) {
        throw new Error(
          `Unable to create auth config: ${data.errors?.join(", ")}`,
        );
      }
      return data;
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        String(err);
      throw new Error(`Failed to create basic auth config: ${msg}`);
    }
  }

  async getAuthConfig(configId: number): Promise<AuthConfigResponse> {
    if (!this.auth?.username || !this.auth?.password) {
      throw new Error(
        "BrowserStack credentials are not set for AccessibilityAuthConfig.",
      );
    }

    try {
      const baseUrl = await getA11yBaseURL(this.config);
      const response = await apiClient.get<AuthConfigResponse>({
        url: `${baseUrl}/api/website-scanner/v1/auth_configs/${configId}`,
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${this.auth.username}:${this.auth.password}`).toString(
              "base64",
            ),
        },
      });

      const data = response.data;
      if (!data.success) {
        throw new Error(
          `Unable to get auth config: ${data.errors?.join(", ")}`,
        );
      }
      return data;
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        String(err);
      throw new Error(`Failed to get auth config: ${msg}`);
    }
  }
}
