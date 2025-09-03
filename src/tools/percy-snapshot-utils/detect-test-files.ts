import fs from "fs";
import path from "path";
import logger from "../../logger.js";

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

async function walkDir(dir: string, extensions: string[]): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          result.push(...(await walkDir(fullPath, extensions)));
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        result.push(fullPath);
      }
    }
  } catch {
    logger.error(`Failed to read directory: ${dir}`);
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
    logger.warn(`Failed to read file: ${filePath}`);
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
    logger.warn(`Failed to read file: ${filePath}`);
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
    logger.error(`Unsupported language: ${language}`);
    return [];
  }

  // Step 1: Collect all files with matching extensions
  let files: string[] = [];
  try {
    files = await walkDir(baseDir, config.extensions);
  } catch {
    return [];
  }

  if (files.length === 0) {
    throw new Error("No files found with the specified extensions");
  }

  const candidateFiles: Map<string, number> = new Map();

  // Step 2: Fast name-based identification with scoring
  for (const file of files) {
    const fileName = path.basename(file);
    const score = getFileScore(fileName, config);

    if (config.namePatterns.some((pattern) => pattern.test(fileName))) {
      candidateFiles.set(file, score);
      logger.debug(`File matched by name pattern: ${file} (score: ${score})`);
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
      logger.debug(`File matched by content regex: ${file} (score: ${score})`);
    }
  });

  await Promise.all(contentCheckPromises);

  // Step 4: Handle SpecFlow .feature files for C# + SpecFlow
  if (language === "csharp" && framework === "specflow") {
    try {
      const featureFiles = await walkDir(baseDir, [".feature"]);
      featureFiles.forEach((file) => candidateFiles.set(file, 2));
      logger.info(`Added ${featureFiles.length} SpecFlow .feature files`);
    } catch {
      logger.warn(
        `Failed to collect SpecFlow .feature files from baseDir: ${baseDir}`,
      );
    }
  }

  if (candidateFiles.size === 0) {
    logger.info("No test files found matching patterns");
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
        logger.debug(`File included - strong UI indicators: ${file}`);
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

      // Skip if explicitly excluded (mocks, unit tests, etc.)
      if (shouldExclude) {
        logger.debug(`File excluded by exclude regex: ${file}`);
        return null;
      }

      // Skip backend tests in any mode
      if (hasBackend) {
        logger.debug(`File excluded as backend test: ${file}`);
        return null;
      }

      // Include if has explicit UI drivers
      if (hasExplicitUI) {
        logger.debug(`File included - explicit UI drivers: ${file}`);
        return file;
      }

      // Include if has UI indicators (for cases where drivers aren't explicitly imported)
      if (hasUIIndicators) {
        logger.debug(`File included - UI indicators: ${file}`);
        return file;
      }

      // In non-strict mode, include high-scoring test files even without explicit UI patterns
      if (!strictMode) {
        const score = candidateFiles.get(file) || 0;
        if (score >= 3) {
          // High confidence UI test based on naming
          logger.debug(
            `File included - high confidence score: ${file} (score: ${score})`,
          );
          return file;
        }
      }

      logger.debug(`File excluded - no UI patterns detected: ${file}`);
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

  logger.info(
    `Returning ${uiFiles.length} UI test files from ${candidateFiles.size} total test files`,
  );
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
