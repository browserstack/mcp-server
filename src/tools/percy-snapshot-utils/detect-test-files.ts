import fs from "fs";
import path from "path";

import {
  SDKSupportedLanguage,
  SDKSupportedTestingFrameworkEnum,
} from "../sdk-utils/common/types.js";

import {
  EXCLUDED_DIRS,
  TEST_FILE_DETECTION,
  backendIndicators,
  strongUIIndicators,
} from "../percy-snapshot-utils/constants.js";

import { DetectionConfig } from "../percy-snapshot-utils/types.js";
import logger from "../../logger.js";
import { CallerError } from "../../lib/error.js";

async function walkDir(
  dir: string,
  extensions: string[],
  depth: number = 6,
): Promise<string[]> {
  const result: string[] = [];
  if (depth < 0) return result;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          result.push(...(await walkDir(fullPath, extensions, depth - 1)));
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        result.push(fullPath);
      }
    }
  } catch {
    logger.info("Failed to read user directory");
  }

  return result;
}

async function fileContainsRegex(
  filePath: string,
  regexes: RegExp[],
): Promise<boolean> {
  if (!regexes.length) return false;

  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return regexes.some((re) => re.test(content));
  } catch {
    return false;
  }
}

async function batchRegexCheck(
  filePath: string,
  regexGroups: RegExp[][],
): Promise<boolean[]> {
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return regexGroups.map((regexes) =>
      regexes.length > 0 ? regexes.some((re) => re.test(content)) : false,
    );
  } catch {
    return regexGroups.map(() => false);
  }
}

async function isLikelyUITest(filePath: string): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    if (backendIndicators.some((pattern) => pattern.test(content))) {
      return false;
    }
    return strongUIIndicators.some((pattern) => pattern.test(content));
  } catch {
    return false;
  }
}

function getFileScore(fileName: string, config: DetectionConfig): number {
  let score = 0;

  // Higher score for explicit UI test naming
  if (/ui|web|e2e|integration|functional/i.test(fileName)) score += 3;
  if (config.namePatterns.some((pattern) => pattern.test(fileName))) score += 2;

  return score;
}

export interface ListTestFilesOptions {
  language: SDKSupportedLanguage;
  framework?: SDKSupportedTestingFrameworkEnum;
  baseDir: string;
  strictMode?: boolean;
}

export async function listTestFiles(
  options: ListTestFilesOptions,
): Promise<string[]> {
  const { language, framework, baseDir, strictMode = false } = options;
  const config = TEST_FILE_DETECTION[language];

  if (!config) {
    return [];
  }

  // Step 1: Collect all files with matching extensions
  let files: string[] = [];
  try {
    files = await walkDir(baseDir, config.extensions, 6);
  } catch {
    return [];
  }

  if (files.length === 0) {
    throw new CallerError("No files found with the specified extensions");
  }

  const candidateFiles: Map<string, number> = new Map();

  // Step 2: Fast name-based identification with scoring
  for (const file of files) {
    const fileName = path.basename(file);
    const score = getFileScore(fileName, config);

    if (config.namePatterns.some((pattern) => pattern.test(fileName))) {
      candidateFiles.set(file, score);
    }
  }

  // Step 3: Content-based test detection for remaining files
  const remainingFiles = files.filter((file) => !candidateFiles.has(file));
  const contentCheckPromises = remainingFiles.map(async (file) => {
    const hasTestContent = await fileContainsRegex(file, config.contentRegex);
    if (hasTestContent) {
      const fileName = path.basename(file);
      const score = getFileScore(fileName, config);
      candidateFiles.set(file, score);
    }
  });

  await Promise.all(contentCheckPromises);

  // Step 4: Handle SpecFlow .feature files for C# + SpecFlow
  if (language === "csharp" && framework === "specflow") {
    try {
      const featureFiles = await walkDir(baseDir, [".feature"], 6);
      featureFiles.forEach((file) => candidateFiles.set(file, 2));
    } catch {
      // ignore
    }
  }

  if (candidateFiles.size === 0) {
    return [];
  }

  // Step 6: UI Detection with fallback patterns
  const uiFiles: string[] = [];
  const filesToCheck = Array.from(candidateFiles.keys());

  // Batch process UI detection for better performance
  const batchSize = 10;
  for (let i = 0; i < filesToCheck.length; i += batchSize) {
    const batch = filesToCheck.slice(i, i + batchSize);

    const batchPromises = batch.map(async (file) => {
      // First, use the new precise UI detection
      const isUITest = await isLikelyUITest(file);

      if (isUITest) {
        return file;
      }

      // If not clearly UI, run the traditional checks
      const [hasExplicitUI, hasUIIndicators, hasBackend, shouldExclude] =
        await batchRegexCheck(file, [
          config.uiDriverRegex,
          config.uiIndicatorRegex,
          config.backendRegex,
          config.excludeRegex || [],
        ]);

      if (shouldExclude) {
        return null;
      }

      if (hasBackend) {
        return null;
      }

      if (hasExplicitUI) {
        return file;
      }

      if (hasUIIndicators) {
        return file;
      }

      if (!strictMode) {
        const score = candidateFiles.get(file) || 0;
        if (score >= 3) {
          return file;
        }
      }

      return null;
    });

    const batchResults = await Promise.all(batchPromises);
    uiFiles.push(
      ...batchResults.filter((file): file is string => file !== null),
    );
  }

  // Step 7: Sort by score (higher confidence files first)
  uiFiles.sort((a, b) => {
    const scoreA = candidateFiles.get(a) || 0;
    const scoreB = candidateFiles.get(b) || 0;
    return scoreB - scoreA;
  });

  return uiFiles;
}

export async function listUITestFilesStrict(
  options: Omit<ListTestFilesOptions, "strictMode">,
): Promise<string[]> {
  return listTestFiles({ ...options, strictMode: true });
}

export async function listUITestFilesRelaxed(
  options: Omit<ListTestFilesOptions, "strictMode">,
): Promise<string[]> {
  return listTestFiles({ ...options, strictMode: false });
}
