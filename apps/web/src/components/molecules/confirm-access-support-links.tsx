import Link from "next/link";
import { resolveMessage } from "@lcsp/i18n";

import { Card, CardContent } from "@/components/ui/card";
import { appLocale } from "@/lib/locale";
import type { ConfirmAccessSupportLinksProps } from "@/components/types/confirm-access-dialog.types";
import { CONFIRM_ACCESS_SUPPORT_ITEM_KINDS } from "@/components/types/confirm-access-dialog.types";

export function ConfirmAccessSupportLinks({
  titleKey,
  items,
}: ConfirmAccessSupportLinksProps) {
  if (!items.length) {
    return null;
  }

  // The parent confirmation body scrolls on short viewports; preserve the support card so its actions do not collapse.
  return (
    <Card className="shrink-0 py-0">
      <CardContent className="space-y-3 px-5 py-5">
        <h3 className="text-lg font-semibold">
          {resolveMessage(appLocale, titleKey)}
        </h3>
        <ul className="space-y-2 pl-5 text-sm text-primary">
          {items.map((item, index) => (
            <li
              key={`${item.labelKey}:${index}`}
              className="list-disc"
            >
              {item.kind === CONFIRM_ACCESS_SUPPORT_ITEM_KINDS.link ? (
                <Link
                  href={item.href}
                  className="underline-offset-4 hover:underline"
                >
                  {resolveMessage(appLocale, item.labelKey)}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={item.onSelect}
                  className="cursor-pointer underline-offset-4 hover:underline"
                >
                  {resolveMessage(appLocale, item.labelKey)}
                </button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
