"use client";
import { use, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  CorpusVersionDetailPage,
  CorpusVersionsLoading,
} from "@/features/admin/components/organisms/corpus-versions-page";
import {
  useAdminCorpusVersionQuery,
  useDiscardAdminCorpusVersionMutation,
  usePublishAdminCorpusVersionMutation,
} from "@/lib/api/admin-corpus-versions-queries";
import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
export default function AdminCorpusVersionDetailRoute({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = use(params);
  const router = useRouter();
  const query = useAdminCorpusVersionQuery(versionId);
  const discard = useDiscardAdminCorpusVersionMutation(versionId);
  const publish = usePublishAdminCorpusVersionMutation(versionId);
  const publishKey = useRef<string | null>(null);
  const discardKey = useRef<string | null>(null);
  if (query.isLoading) return <CorpusVersionsLoading />;
  if (query.error || !query.data)
    return (
      <div className="py-16 text-center">
        <p>
          {resolveAppMessage("pages.admin.corpusVersions.error" as MessageKey)}
        </p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => query.refetch()}
        >
          {resolveAppMessage("pages.admin.corpusVersions.retry" as MessageKey)}
        </Button>
      </div>
    );
  return (
    <CorpusVersionDetailPage
      detail={query.data}
      onBack={() => router.push("/admin/corpus-versions")}
      onPublish={() => {
        const key =
          publishKey.current ??
          (publishKey.current = globalThis.crypto.randomUUID());
        publish.mutate(key, {
          onSuccess: () => {
            publishKey.current = null;
          },
        });
      }}
      onDiscard={() =>
        discard.mutate(
          discardKey.current ??
            (discardKey.current = globalThis.crypto.randomUUID()),
          {
            onSuccess: () => {
              discardKey.current = null;
              router.replace("/admin/corpus-versions");
            },
          },
        )
      }
      isDiscarding={discard.isPending}
      discardFailed={discard.isError}
      isPublishing={publish.isPending}
      publishFailed={publish.isError}
    />
  );
}
