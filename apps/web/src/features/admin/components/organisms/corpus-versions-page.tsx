"use client";

import { useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";
import type {
  AdminCorpusVersionDetail,
  AdminCorpusVersionSummary,
} from "@lcsp/contracts/legal-rule-catalog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AdminPageHeader } from "@/features/admin/components/molecules/admin-page-header";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";

const key = (value: string) =>
  `pages.admin.corpusVersions.${value}` as MessageKey;
const text = (value: string) => resolveAppMessage(key(value));
const template = (value: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce(
    (result, [name, replacement]) =>
      result.replace(`{${name}}`, String(replacement)),
    text(value),
  );
const shown = (value: string | number | null) => value ?? text("unavailable");
const lifecycleStatus = (value: string) => text(`statuses.${value}`);
const readinessState = (value: string) => text(`readinessStates.${value}`);
const snapshotCategory = (value: string) => text(`snapshotCategories.${value}`);
const snapshotChange = (
  value: AdminCorpusVersionDetail["snapshot"][number]["change"],
) => (value ? template("changeSummary", value) : text("unavailable"));
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(appLocale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : text("noValue");

export function CorpusVersionsPage({
  versions,
  currentPublished,
  onView,
}: {
  versions: AdminCorpusVersionSummary[];
  currentPublished: AdminCorpusVersionSummary | null;
  onView: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-6 pb-12">
      <AdminPageHeader
        title={text("title")}
        description={text("description")}
        actionSlot={
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} />}>
              <Button type="button" disabled>
                {text("create")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{text("createUnavailable")}</TooltipContent>
          </Tooltip>
        }
      />
      <section className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <p className="text-xs font-medium text-muted-foreground">
          {text("current")}
        </p>
        {currentPublished ? (
          <div className="mt-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-xl font-semibold">
                {currentPublished.version}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {template("currentMeta", {
                  count: currentPublished.sourceCount,
                  publishedAt: date(currentPublished.publishedAt),
                })}
              </p>
              <p className="hidden">
                {currentPublished.sourceCount} {text("sources")} ·{" "}
                {date(currentPublished.publishedAt)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => onView(currentPublished.id)}
            >
              {text("view")}
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {text("noValue")}
          </p>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{text("versions")}</h2>
        <CorpusVersionsTable versions={versions} onView={onView} />
      </section>
      <aside className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {text("note")}
      </aside>
    </div>
  );
}

function CorpusVersionsTable({
  versions,
  onView,
}: {
  versions: AdminCorpusVersionSummary[];
  onView: (id: string) => void;
}) {
  const columns = [
    "version",
    "status",
    "sources",
    "rules",
    "created",
    "published",
    "actions",
  ];
  return (
    <div className="rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column} className="text-xs text-muted-foreground">
                {text(column)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.map((version) => (
            <TableRow key={version.id}>
              <TableCell className="font-medium">{version.version}</TableCell>
              <TableCell>{lifecycleStatus(version.status)}</TableCell>
              <TableCell>{version.sourceCount}</TableCell>
              <TableCell>{shown(version.ruleCount)}</TableCell>
              <TableCell>{date(version.createdAt)}</TableCell>
              <TableCell>{date(version.publishedAt)}</TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onView(version.id)}
                >
                  {text("view")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function CorpusVersionDetailPage({
  detail,
  onBack,
  onDiscard,
  isDiscarding,
  discardFailed,
}: {
  detail: AdminCorpusVersionDetail;
  onBack: () => void;
  onDiscard: () => void;
  isDiscarding: boolean;
  discardFailed: boolean;
}) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const metadata: Array<[string, string | number | null]> = [
    ["status", lifecycleStatus(detail.status)],
    ["baseVersion", detail.baseVersion],
    ["created", date(detail.createdAt)],
    ["createdBy", detail.createdBy],
    ["sources", detail.sourceCount],
    ["rules", detail.ruleCount],
  ];
  const changes: Array<[string, string | number | null]> = [
    ["sourceAdded", detail.sourcesAdded],
    ["sourceRemoved", detail.sourcesRemoved],
    ["sourceUpdated", detail.sourcesUpdated],
    ["legalRulesChanged", detail.legalRulesChanged],
    ["engineeringRulesChanged", detail.engineeringRulesChanged],
    ["conflicts", detail.unresolvedConflicts],
  ];
  return (
    <div className="flex flex-col gap-6 pb-12">
      <AdminPageHeader
        title={template("detailTitle", { version: detail.version })}
        description={lifecycleStatus(detail.status)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeftIcon />
          {text("back")}
        </Button>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} />}>
              <Button type="button" disabled>
                {text("publish")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{text("publishUnavailable")}</TooltipContent>
          </Tooltip>
          {detail.actions.canDiscard ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardOpen(true)}
            >
              {text("discard")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <DetailCard title={text("metadata")} rows={metadata} />
        <DetailCard title={text("changes")} rows={changes} />
        <DetailCard
          title={text("readiness")}
          rows={detail.readinessItems.map((item): [string, string] => [
            `readinessChecks.${item.check}`,
            readinessState(item.state),
          ])}
        />
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{text("snapshot")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {["category", "count", "change", "validation"].map((column) => (
                  <TableHead key={column}>{text(column)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.snapshot.map((row) => (
                <TableRow key={row.category}>
                  <TableCell>{snapshotCategory(row.category)}</TableCell>
                  <TableCell>{shown(row.count)}</TableCell>
                  <TableCell>{snapshotChange(row.change)}</TableCell>
                  <TableCell>{readinessState(row.validation)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <aside className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {text("note")}
      </aside>
      <Dialog
        open={discardOpen}
        onOpenChange={(open) => {
          if (!isDiscarding) setDiscardOpen(open);
        }}
      >
        <DialogContent showCloseButton={!isDiscarding}>
          <DialogHeader>
            <DialogTitle>{text("discardTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>{text("discardDescription")}</DialogDescription>
            {discardFailed ? (
              <Alert className="mt-4" variant="destructive">
                <AlertTitle>{text("discardFailedTitle")}</AlertTitle>
                <AlertDescription>
                  {text("discardFailedDetail")}
                </AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter className="flex-row justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isDiscarding}
              onClick={() => setDiscardOpen(false)}
            >
              {text("cancel")}
            </Button>
            <Button type="button" disabled={isDiscarding} onClick={onDiscard}>
              {isDiscarding ? text("discarding") : text("confirmDiscard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | number | null]>;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-start justify-between gap-3 text-xs"
          >
            <dt className="text-muted-foreground">{text(label)}</dt>
            <dd className="text-right font-medium">{shown(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function CorpusVersionsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
