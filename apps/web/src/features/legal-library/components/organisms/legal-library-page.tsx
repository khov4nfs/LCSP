import Link from "next/link";
import { ExternalLinkIcon, FileDownIcon, ScaleIcon } from "lucide-react";
import { resolveMessage } from "@lcsp/i18n";
import {
  LEGAL_RISK_LEVELS,
  type LegalRiskLevel,
} from "@lcsp/contracts/legal-rule-catalog";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { appLocale } from "@/lib/locale";
import {
  getLegalDocument,
  legalDocumentChunks,
  legalDocuments,
  type LegalDocument,
} from "../../config/legal-documents";

type LegalDocumentCopy = {
  title: string;
  reference: string;
  issuedOn: string;
  effectiveOn: string;
  authority: string;
};

export function LegalLibraryPage() {
  return (
    <main className="flex flex-1 flex-col px-4 py-6 text-foreground lg:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-semibold">
            {resolveMessage(appLocale, "pages.legalLibrary.pageTitle")}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {resolveMessage(appLocale, "pages.legalLibrary.pageDescription")}
          </p>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          {legalDocuments.map((document) => (
            <LegalDocumentCard key={document.id} document={document} />
          ))}
        </section>

        <LegalRiskTable />
      </div>
    </main>
  );
}

function LegalRiskTable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {resolveMessage(appLocale, "pages.legalLibrary.riskTableTitle")}
        </CardTitle>
        <CardDescription>
          {resolveMessage(
            appLocale,
            "pages.legalLibrary.riskTableDescription",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {resolveMessage(appLocale, "pages.legalLibrary.chunkIdLabel")}
              </TableHead>
              <TableHead>
                {resolveMessage(appLocale, "pages.legalLibrary.documentLabel")}
              </TableHead>
              <TableHead>
                {resolveMessage(appLocale, "pages.legalLibrary.locatorLabel")}
              </TableHead>
              <TableHead>
                {resolveMessage(appLocale, "pages.legalLibrary.riskLevelLabel")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {legalDocumentChunks.map((chunk) => {
              const document = getLegalDocument(chunk.documentId);

              if (!document) {
                return null;
              }

              return (
                <TableRow key={chunk.id}>
                  <TableCell className="font-mono text-xs">{chunk.id}</TableCell>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/laws/${document.id}`}
                    >
                      {getLegalDocumentCopy(document).title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {chunk.pageStart}-{chunk.pageEnd}
                  </TableCell>
                  <TableCell>
                    <RiskLevelBadge riskLevel={chunk.riskLevel} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableCaption>
            {resolveMessage(appLocale, "pages.legalLibrary.riskTableDisclaimer")}
          </TableCaption>
        </Table>
      </CardContent>
    </Card>
  );
}

function RiskLevelBadge({ riskLevel }: { riskLevel: LegalRiskLevel }) {
  const variant =
    riskLevel === LEGAL_RISK_LEVELS.high
      ? "destructive"
      : riskLevel === LEGAL_RISK_LEVELS.medium
        ? "secondary"
        : "outline";

  return (
    <Badge variant={variant}>
      {getRiskLevelLabel(riskLevel)}
    </Badge>
  );
}

function getRiskLevelLabel(riskLevel: LegalRiskLevel): string {
  if (riskLevel === LEGAL_RISK_LEVELS.high) {
    return resolveMessage(appLocale, "pages.legalLibrary.riskLevels.HIGH");
  }

  if (riskLevel === LEGAL_RISK_LEVELS.medium) {
    return resolveMessage(appLocale, "pages.legalLibrary.riskLevels.MEDIUM");
  }

  return resolveMessage(appLocale, "pages.legalLibrary.riskLevels.LOW");
}

function LegalDocumentCard({ document }: { document: LegalDocument }) {
  const copy = getLegalDocumentCopy(document);
  const fileHref = `/laws/${document.id}/file`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <ScaleIcon className="mt-0.5 size-5 text-primary" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>
              {resolveMessage(
                appLocale,
                "pages.legalLibrary.documentReferenceLabel",
              )}: {copy.reference}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <MetadataRow
          label={resolveMessage(appLocale, "pages.legalLibrary.issuedOnLabel")}
          value={copy.issuedOn}
        />
        <MetadataRow
          label={resolveMessage(appLocale, "pages.legalLibrary.effectiveOnLabel")}
          value={copy.effectiveOn}
        />
        <MetadataRow
          label={resolveMessage(appLocale, "pages.legalLibrary.authorityLabel")}
          value={copy.authority}
        />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          render={<Link href={`/laws/${document.id}`} />}
          nativeButton={false}
        >
          {resolveMessage(appLocale, "pages.legalLibrary.readDocument")}
        </Button>
        <Button
          render={<a href={fileHref} download />}
          nativeButton={false}
          variant="outline"
        >
          <FileDownIcon data-icon="inline-start" aria-hidden="true" />
          {resolveMessage(appLocale, "pages.legalLibrary.downloadDocument")}
        </Button>
        <Button
          render={
            <a
              href={document.officialSourceUrl}
              target="_blank"
              rel="noreferrer"
            />
          }
          nativeButton={false}
          variant="ghost"
        >
          <ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />
          {resolveMessage(appLocale, "pages.legalLibrary.openOfficialSource")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function getLegalDocumentCopy(document: LegalDocument): LegalDocumentCopy {
  if (document.messageKey === "aiLaw") {
    return {
      title: resolveMessage(
        appLocale,
        "pages.legalLibrary.documents.aiLaw.title",
      ),
      reference: resolveMessage(
        appLocale,
        "pages.legalLibrary.documents.aiLaw.reference",
      ),
      issuedOn: resolveMessage(
        appLocale,
        "pages.legalLibrary.documents.aiLaw.issuedOn",
      ),
      effectiveOn: resolveMessage(
        appLocale,
        "pages.legalLibrary.documents.aiLaw.effectiveOn",
      ),
      authority: resolveMessage(
        appLocale,
        "pages.legalLibrary.documents.aiLaw.authority",
      ),
    };
  }

  return {
    title: resolveMessage(
      appLocale,
      "pages.legalLibrary.documents.digitalTechnologyIndustryLaw.title",
    ),
    reference: resolveMessage(
      appLocale,
      "pages.legalLibrary.documents.digitalTechnologyIndustryLaw.reference",
    ),
    issuedOn: resolveMessage(
      appLocale,
      "pages.legalLibrary.documents.digitalTechnologyIndustryLaw.issuedOn",
    ),
    effectiveOn: resolveMessage(
      appLocale,
      "pages.legalLibrary.documents.digitalTechnologyIndustryLaw.effectiveOn",
    ),
    authority: resolveMessage(
      appLocale,
      "pages.legalLibrary.documents.digitalTechnologyIndustryLaw.authority",
    ),
  };
}
