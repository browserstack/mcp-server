import { customFuzzySearch } from "../../lib/fuzzy";
import { DeviceEntry } from "./start-session";

/**
 * Fuzzy searches App Live device entries by name.
 */
export async function fuzzySearchDevices(
  devices: DeviceEntry[],
  query: string,
  limit: number = 5,
): Promise<DeviceEntry[]> {
  const top_match = customFuzzySearch(
    devices,
    ["device", "display_name"],
    query,
    limit,
  );
  return top_match;
}
