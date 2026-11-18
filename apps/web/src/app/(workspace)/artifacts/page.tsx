import { ArtifactsPage } from "@/features/artifacts/components/artifacts-page";
import { getArtifactGroups } from "@/features/artifacts/server/get-artifact-groups";

/**
 * Business purpose: Render the workspace statutory audit artifacts explorer page.
 *
 * Business rules:
 * - Displays all generated final reports and compliance artifacts available to the workspace.
 *
 * Execution flow:
 * 1. Fetch available artifact groups for the authenticated workspace.
 * 2. Render the interactive ArtifactsPage component with the retrieved groups.
 *
 * Failure cases:
 * - Empty or missing groups render the standard empty state.
 *
 * Side effects:
 * - None: read-only server component render.
 */
export default async function ArtifactsRoute() {
  const groups = await getArtifactGroups();
  return <ArtifactsPage groups={groups} />;
}
