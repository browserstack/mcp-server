/**
 * Percy API Zod schemas and inferred TypeScript types.
 *
 * All schemas use `.passthrough()` to allow extra fields from the API
 * without throwing validation errors. This ensures forward compatibility
 * as the Percy API evolves.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export const PercyBuildSchema = z
  .object({
    id: z.string(),
    type: z.literal("builds").optional(),
    state: z.string(),
    branch: z.string().nullable(),
    buildNumber: z.number().nullable(),
    reviewState: z.string().nullable(),
    reviewStateReason: z.string().nullable(),
    totalSnapshots: z.number().nullable(),
    totalComparisons: z.number().nullable(),
    totalComparisonsDiff: z.number().nullable(),
    failedSnapshotsCount: z.number().nullable(),
    failureReason: z.string().nullable(),
    createdAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    aiDetails: z.any().nullable(),
    errorBuckets: z.array(z.any()).nullable(),
  })
  .passthrough();

export type PercyBuild = z.infer<typeof PercyBuildSchema>;

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------
export const PercyComparisonSchema = z
  .object({
    id: z.string(),
    state: z.string().nullable(),
    width: z.number().nullable(),
    diffRatio: z.number().nullable(),
    aiDiffRatio: z.number().nullable(),
    aiProcessingState: z.string().nullable(),
    aiDetails: z.any().nullable(),
    appliedRegions: z.array(z.any()).nullable(),
  })
  .passthrough();

export type PercyComparison = z.infer<typeof PercyComparisonSchema>;

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------
export const PercySnapshotSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    reviewState: z.string().nullable(),
    reviewStateReason: z.string().nullable(),
  })
  .passthrough();

export type PercySnapshot = z.infer<typeof PercySnapshotSchema>;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------
export const PercyProjectSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    slug: z.string().nullable(),
  })
  .passthrough();

export type PercyProject = z.infer<typeof PercyProjectSchema>;

// ---------------------------------------------------------------------------
// Build Summary
// ---------------------------------------------------------------------------
export const PercyBuildSummarySchema = z
  .object({
    id: z.string(),
    summary: z.string().nullable(),
  })
  .passthrough();

export type PercyBuildSummary = z.infer<typeof PercyBuildSummarySchema>;
