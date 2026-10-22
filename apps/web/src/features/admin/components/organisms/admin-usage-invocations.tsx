"use client";
import { useState } from "react";
import type {
  UsageInvocation,
  UsageInvocationsProps,
} from "../../types/admin-usage.types";
import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "@/components/ui/dialog";
import {
  USAGE_TOKEN_FIELDS,
  USAGE_INVOCATION_COLUMNS,
  USAGE_INVOCATION_DETAILS,
} from "../../config/admin-usage.config";
export function AdminUsageInvocations({ items }: UsageInvocationsProps) {
  const [selected, select] = useState<UsageInvocation | null>(null);
  const m = (key: string) =>
    resolveAppMessage(`pages.admin.usage.${key}` as MessageKey);
  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{m("invocations")}</caption>
          <thead>
            <tr>
              {USAGE_INVOCATION_COLUMNS.map((k) => (
                <th key={k} className="p-3">
                  {m(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="p-3">
                  {new Date(item.occurredAt).toISOString()}
                </td>
                <td className="p-3">{item.provider}</td>
                <td className="p-3">{item.model}</td>
                <td className="p-3">{item.agentRole}</td>
                <td className="p-3">{m(item.attemptStatus ?? "UNKNOWN")}</td>
                <td className="p-3">
                  {item.referenceCost?.estimatedCostUsd == null
                    ? m(item.referenceCost?.status ?? "UNPRICED")
                    : `$${item.referenceCost.estimatedCostUsd}`}
                </td>
                <td className="p-3">
                  <Button
                    variant="outline"
                    onClick={() => select(item)}
                    aria-label={`${m("details")} ${item.invocationId}`}
                  >
                    {m("details")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length ? (
          <p className="p-6 text-muted-foreground">{m("empty")}</p>
        ) : null}
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) select(null);
        }}
      >
        <DialogContent closeLabel={m("close")}>
          <DialogHeader>
            <DialogTitle>{m("details")}</DialogTitle>
            <DialogDescription>{m("description")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-128 space-y-3 overflow-y-auto">
            {selected ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {USAGE_INVOCATION_DETAILS.map((k) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{m(k)}</dt>
                    <dd className="break-all">{selected[k] ?? m("UNKNOWN")}</dd>
                  </div>
                ))}
                {USAGE_TOKEN_FIELDS.map((k) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{m(k)}</dt>
                    <dd>{selected.tokens[k] ?? m("UNKNOWN")}</dd>
                  </div>
                ))}
                <div>
                  <dt>{m("priceVersion")}</dt>
                  <dd className="break-all">
                    {selected.referenceCost?.priceVersionId ?? m("UNPRICED")}
                  </dd>
                </div>
                <div>
                  <dt>{m("canonicalModel")}</dt>
                  <dd>
                    {selected.referenceCost?.developer}{" "}
                    {selected.referenceCost?.canonicalModel ?? m("UNKNOWN")}
                  </dd>
                </div>
                <div>
                  <dt>{m("usageCompleteness")}</dt>
                  <dd>{m(selected.referenceCost?.status ?? "UNKNOWN")}</dd>
                </div>
                <div>
                  <dt>{m("knownSubtotal")}</dt>
                  <dd>
                    {selected.referenceCost
                      ? `$${selected.referenceCost.knownCostUsd}`
                      : m("UNKNOWN")}
                  </dd>
                </div>
                {selected.referenceCost?.sourceUrl ? (
                  <a
                    href={selected.referenceCost.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="col-span-2 underline"
                  >
                    {m("priceSource")}
                  </a>
                ) : null}
              </dl>
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
