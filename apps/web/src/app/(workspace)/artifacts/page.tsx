import { ArtifactsPage } from "@/features/artifacts/components/artifacts-page";
import { ARTIFACT_PREVIEW_GROUPS } from "@/features/artifacts/dev/artifact-preview-fixtures";

export default async function ArtifactsRoute({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const params = await searchParams;
  const preview = process.env.NODE_ENV === "development" && params.preview === "populated";
  return <ArtifactsPage groups={preview ? ARTIFACT_PREVIEW_GROUPS : []} />;
}
