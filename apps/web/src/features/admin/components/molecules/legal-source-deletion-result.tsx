import type { LegalSourceDeletionResultProps } from "../../types/legal-source-lifecycle.types";
import Link from "next/link";
import { resolveAppMessage as t } from "@/lib/i18n";

export function LegalSourceDeletionResult({
  receipt,
}: LegalSourceDeletionResultProps) {
  return (
    <div role="status" className="space-y-3 rounded-lg border bg-card p-6">
      <h1 className="text-2xl font-semibold">
        {t("pages.legalLifecycle.deleted")}
      </h1>
      <dl className="space-y-2 break-all text-sm">
        <div>
          <dt>{t("pages.legalLifecycle.sourceId")}</dt>
          <dd>{receipt.sourceId}</dd>
        </div>
        <div>
          <dt>{t("pages.legalLifecycle.receipt")}</dt>
          <dd>{receipt.deletionReceiptId}</dd>
        </div>
        <div>
          <dt>{t("pages.legalLifecycle.deletedAt")}</dt>
          <dd>{receipt.deletedAt}</dd>
        </div>
        <div>
          <dt>{t("pages.legalLifecycle.snapshots")}</dt>
          <dd>{receipt.retainedIndependentSnapshotCount}</dd>
        </div>
      </dl>
      <p className="text-sm">{t("pages.legalLifecycle.auditPreserved")}</p>
      <Link href="/admin/legal-sources" className="text-primary underline">
        {t("pages.legalLifecycle.returnToSources")}
      </Link>
    </div>
  );
}
