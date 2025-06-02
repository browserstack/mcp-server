import {
  getDevicesAndBrowsers,
  BrowserStackProducts,
} from "../../lib/device-cache.js";
import { resolveVersion } from "../../lib/version-resolver.js";
import { customFuzzySearch } from "../../lib/fuzzy.js";
import { DesktopSearchArgs, DesktopEntry } from "./types.js";

export async function filterDesktop(
  args: DesktopSearchArgs,
): Promise<DesktopEntry> {
  const data = await getDevicesAndBrowsers(BrowserStackProducts.LIVE);
  const allEntries = getAllDesktopEntries(data);

  // Filter OS
  const osList = filterByOS(allEntries, args.os);

  // Filter browser
  const browserList = filterByBrowser(osList, args.browser, args.os);

  // Resolve OS version
  const uniqueOSVersions = getUniqueOSVersions(browserList);
  const chosenOS = resolveOSVersion(args.os, args.osVersion, uniqueOSVersions);

  // Filter entries based on chosen OS version
  const entriesForOS = filterByOSVersion(browserList, chosenOS);

  // Resolve browser version
  const browserVersions = entriesForOS.map((e) => e.browser_version);
  const chosenBrowserVersion = resolveVersion(
    args.browserVersion,
    browserVersions,
  );

  // Find final entry
  const finalEntry = entriesForOS.find(
    (e) => e.browser_version === chosenBrowserVersion,
  );
  if (!finalEntry) {
    throw new Error(`No entry for browser version "${args.browserVersion}".`);
  }

  // Add notes if versions were adjusted
  addNotes(finalEntry, args, chosenOS, chosenBrowserVersion);

  return finalEntry;
}

function getAllDesktopEntries(data: any): DesktopEntry[] {
  return data.desktop.flatMap((plat: any) =>
    plat.browsers.map((b: any) => ({
      os: plat.os,
      os_version: plat.os_version,
      browser: b.browser,
      browser_version: b.browser_version,
    })),
  );
}

function filterByOS(entries: DesktopEntry[], os: string): DesktopEntry[] {
  const filtered = entries.filter((e) => e.os === os);
  if (!filtered.length) throw new Error(`No OS entries for "${os}".`);
  return filtered;
}

function filterByBrowser(
  entries: DesktopEntry[],
  browser: string,
  os: string,
): DesktopEntry[] {
  const filtered = entries.filter((e) => e.browser === browser);
  if (!filtered.length) throw new Error(`No browser "${browser}" on ${os}.`);
  return filtered;
}

function getUniqueOSVersions(entries: DesktopEntry[]): string[] {
  return Array.from(new Set(entries.map((e) => e.os_version)));
}

function resolveOSVersion(
  os: string,
  requestedVersion: string,
  availableVersions: string[],
): string {
  if (os === "OS X") {
    return resolveMacOSVersion(requestedVersion, availableVersions);
  } else {
    // For Windows, use semantic versioning
    return resolveVersion(requestedVersion, availableVersions);
  }
}

function resolveMacOSVersion(requested: string, available: string[]): string {
  if (requested === "latest") {
    return available[available.length - 1];
  } else if (requested === "oldest") {
    return available[0];
  } else {
    // Try fuzzy matching
    const fuzzy = customFuzzySearch(
      available.map((v) => ({ os_version: v })),
      ["os_version"],
      requested,
      1,
    );
    const matched = fuzzy.length ? fuzzy[0].os_version : requested;

    // Fallback if not valid
    return available.includes(matched) ? matched : available[0];
  }
}

function filterByOSVersion(
  entries: DesktopEntry[],
  osVersion: string,
): DesktopEntry[] {
  return entries.filter((e) => e.os_version === osVersion);
}

function addNotes(
  entry: DesktopEntry,
  args: DesktopSearchArgs,
  resolvedOS: string,
  resolvedBrowser: string,
): void {
  if (
    args.osVersion !== resolvedOS &&
    args.osVersion !== "latest" &&
    args.osVersion !== "oldest"
  ) {
    entry.notes = `Note: OS version ${args.osVersion} was not found. Using "${resolvedOS}" instead.`;
  }

  if (
    args.browserVersion !== resolvedBrowser &&
    args.browserVersion !== "latest" &&
    args.browserVersion !== "oldest"
  ) {
    if (!entry.notes) {
      entry.notes = `Note: `;
    } else {
      entry.notes += ` `;
    }
    entry.notes += `Browser version ${args.browserVersion} was not found. Using "${resolvedBrowser}" instead.`;
  }
}
