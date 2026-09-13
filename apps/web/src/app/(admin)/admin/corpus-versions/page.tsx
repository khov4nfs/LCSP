"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  CorpusVersionsLoading,
  CorpusVersionsPage,
} from "@/features/admin/components/organisms/corpus-versions-page";
import { useAdminCorpusVersionsQuery } from "@/lib/api/admin-corpus-versions-queries";
import { usePrepareAdminCorpusVersionMutation } from "@/lib/api/admin-corpus-versions-queries";
import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";
export default function AdminCorpusVersionsRoute() {
  const router = useRouter();
  const query = useAdminCorpusVersionsQuery();
  const prepare = usePrepareAdminCorpusVersionMutation();
  const prepareKey = useRef<string | null>(null);
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
    <CorpusVersionsPage
      {...query.data}
      onCreate={() => {
        const key =
          prepareKey.current ??
          (prepareKey.current = globalThis.crypto.randomUUID());
        prepare.mutate(key, {
          onSuccess: (result) => {
            prepareKey.current = null;
            router.push(`/admin/corpus-versions/${result.corpusVersionId}`);
          },
        });
      }}
      isCreating={prepare.isPending}
      onView={(id) => router.push(`/admin/corpus-versions/${id}`)}
    />
  );
}
