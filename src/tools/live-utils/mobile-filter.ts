import {
  getDevicesAndBrowsers,
  BrowserStackProducts,
} from "../../lib/device-cache.js";
import { resolveVersion } from "./version-resolver.js";
import { customFuzzySearch } from "../../lib/fuzzy.js";
import { MobileSearchArgs, MobileEntry } from "./types.js";

// Extract all mobile entries from the data
function getAllMobileEntries(data: any): MobileEntry[] {
  return data.mobile.flatMap((grp: any) =>
    grp.devices.map((d: any) => ({
      os: grp.os,
      os_version: d.os_version,
      display_name: d.display_name,
      notes: "",
    })),
  );
}

// Filter entries by OS
function filterByOS(entries: MobileEntry[], os: string): MobileEntry[] {
  const candidates = entries.filter((d) => d.os === os);
  if (!candidates.length) throw new Error(`No mobile OS entries for "${os}".`);
  return candidates;
}

// Find matching device with exact match validation
function findMatchingDevice(
  entries: MobileEntry[],
  deviceName: string,
  os: string,
): MobileEntry[] {
  const matches = customFuzzySearch(entries, ["display_name"], deviceName, 5);
  if (!matches.length)
    throw new Error(`No devices matching "${deviceName}" on ${os}.`);

  const exact = matches.find(
    (m) => m.display_name.toLowerCase() === deviceName.toLowerCase(),
  );
  if (!exact) {
    const names = matches.map((m) => m.display_name).join(", ");
    throw new Error(
      `Alternative Device/Device's found : ${names}. Please Select one.`,
    );
  }

  const result = entries.filter((d) => d.display_name === exact.display_name);
  if (!result.length)
    throw new Error(`No device "${exact.display_name}" on ${os}.`);

  return result;
}

// Find the appropriate OS version
function findOSVersion(
  entries: MobileEntry[],
  requestedVersion: string,
): { entries: MobileEntry[]; chosenVersion: string } {
  const versions = entries.map((d) => d.os_version);
  const chosenVersion = resolveVersion(requestedVersion, versions);

  const result = entries.filter((d) => d.os_version === chosenVersion);
  if (!result.length)
    throw new Error(`No entry for OS version "${requestedVersion}".`);

  return { entries: result, chosenVersion };
}

// Create version note if needed
function createVersionNote(
  requestedVersion: string,
  actualVersion: string,
): string {
  if (
    actualVersion !== requestedVersion &&
    requestedVersion !== "latest" &&
    requestedVersion !== "oldest"
  ) {
    return `Note: Os version ${requestedVersion} was not found. Using ${actualVersion} instead.`;
  }
  return "";
}

export async function filterMobile(
  args: MobileSearchArgs,
): Promise<MobileEntry> {
  const data = await getDevicesAndBrowsers(BrowserStackProducts.LIVE);
  const allEntries = getAllMobileEntries(data);

  const osCandidates = filterByOS(allEntries, args.os);
  const deviceCandidates = findMatchingDevice(
    osCandidates,
    args.device,
    args.os,
  );

  const { entries: versionCandidates, chosenVersion } = findOSVersion(
    deviceCandidates,
    args.osVersion,
  );

  const final = versionCandidates[0];
  final.notes = createVersionNote(args.osVersion, chosenVersion);

  return final;
}
