import type { AxiosRequestConfig } from "axios";

const TRUSTED_ASSET_HOST_PATTERN =
  /(^|\.)browserstack\.com$|\.s3([.-][a-z0-9-]+)*\.amazonaws\.com$|\.backblazeb2\.com$/;

export function isTrustedAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && TRUSTED_ASSET_HOST_PATTERN.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export function trustedRedirectGuard(
  label: string,
): NonNullable<AxiosRequestConfig["beforeRedirect"]> {
  return (options) => {
    const redirectOptions = options as {
      href?: string;
      protocol?: string;
      host?: string;
      path?: string;
    };
    const target =
      redirectOptions.href ??
      `${redirectOptions.protocol}//${redirectOptions.host}${redirectOptions.path ?? ""}`;
    if (!isTrustedAssetUrl(target)) {
      throw new Error(
        `Refusing to follow ${label} redirect to an untrusted host`,
      );
    }
  };
}
