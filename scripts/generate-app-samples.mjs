#!/usr/bin/env node
/**
 * Generate sample PNG screenshots for App Percy BYOS testing.
 *
 * Reads device.json from each folder under resources/app-percy-samples/
 * and generates matching-dimension PNGs using sharp.
 *
 * Usage: node scripts/generate-app-samples.mjs
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, "..", "resources", "app-percy-samples");

const SCREENSHOT_NAMES = ["Home Screen", "Login Screen"];
const COLORS = [
  { r: 230, g: 230, b: 250 }, // lavender
  { r: 230, g: 250, b: 230 }, // green
  { r: 250, g: 240, b: 230 }, // peach
];

async function main() {
  const entries = await readdir(SAMPLES_DIR);
  let colorIdx = 0;

  for (const entry of entries) {
    const folderPath = join(SAMPLES_DIR, entry);
    const folderStat = await stat(folderPath);
    if (!folderStat.isDirectory()) continue;

    const configPath = join(folderPath, "device.json");
    try {
      await stat(configPath);
    } catch {
      continue;
    }

    const config = JSON.parse(await readFile(configPath, "utf-8"));
    const [width, height] = config.deviceScreenSize.split("x").map(Number);
    const bg = COLORS[colorIdx % COLORS.length];
    colorIdx++;

    for (const name of SCREENSHOT_NAMES) {
      const filePath = join(folderPath, `${name}.png`);
      await sharp({
        create: { width, height, channels: 3, background: bg },
      })
        .png({ compressionLevel: 9 })
        .toFile(filePath);

      console.log(`  ✓ ${entry}/${name}.png (${width}×${height})`);
    }
  }

  console.log("\nDone. Sample PNGs generated in resources/app-percy-samples/");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
