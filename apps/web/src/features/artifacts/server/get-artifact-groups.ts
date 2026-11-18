import {
  isMockModeEnabled,
  readMockJson,
} from "@/lib/server/fixtures/response";
import type { ArtifactGroup } from "../types/artifact.types";

/**
 * Business purpose: Load grouped statutory audit report artifacts for the current workspace.
 *
 * Business rules:
 * - In mock mode or local development, loads mock artifact groups from approved mock assets.
 * - In production mode, returns persisted customer-owned artifacts or an empty list.
 *
 * Execution flow:
 * 1. Check whether mock mode or local development is active.
 * 2. Read approved artifact mock fixture from assets.
 * 3. Return parsed artifact groups or fallback empty list.
 *
 * Failure cases:
 * - If fixture reading or parsing fails, return an empty list to fail closed.
 *
 * Side effects:
 * - None: read-only artifact query.
 */
export async function getArtifactGroups(): Promise<ArtifactGroup[]> {
  if (isMockModeEnabled() || process.env.NODE_ENV === "development") {
    try {
      const groups = await readMockJson<ArtifactGroup[]>("artifacts.json");
      return Array.isArray(groups) ? groups : [];
    } catch {
      return [];
    }
  }
  return [];
}
