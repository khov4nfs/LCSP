"use client";

import type { LegalSourceAddDocumentProps } from "../../types/legal-source-lifecycle.types";

import { useState } from "react";
import { resolveAppMessage as t } from "@/lib/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LegalSourceDocumentDialog } from "./legal-source-document-dialog";

export function LegalSourceAddDocumentPanel({
  versionId,
}: LegalSourceAddDocumentProps) {
  const [submitted, setSubmitted] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pages.legalSources.addDocument")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("pages.legalSources.addDocumentDescription")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <LegalSourceDocumentDialog
            versionId={versionId}
            onSuccess={() => setSubmitted(true)}
          />
          <LegalSourceDocumentDialog
            versionId={versionId}
            importFromUrl
            onSuccess={() => setSubmitted(true)}
          />
        </div>
        {submitted ? (
          <Alert>
            <AlertDescription role="status">
              {t("pages.legalLifecycle.submitted")}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
