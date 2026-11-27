import { resolveMessage } from "@lcsp/i18n";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { appLocale } from "@/lib/locale";
import type { SignedInAccountPanelProps } from "@/components/types/confirm-access-dialog.types";

export function SignedInAccountPanel({
  accountLabelKey,
  accountHandle,
  avatarImageSrc,
  avatarFallback,
}: SignedInAccountPanelProps) {
  // The confirmation body becomes a scroll container on short viewports; preserve the identity card's intrinsic height.
  return (
    <Card className="shrink-0 py-0">
      {/* Stack the identity at narrow widths so enlarged text keeps a usable line measure beside the fixed avatar. */}
      <CardContent className="flex items-center gap-4 px-5 py-5 max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:px-2 max-sm:py-3">
        <Avatar size="lg">
          {avatarImageSrc ? <AvatarImage src={avatarImageSrc} alt="" /> : null}
          <AvatarFallback>{avatarFallback}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">
            {resolveMessage(appLocale, accountLabelKey)}
          </p>
          {/* Keep the full account identifier readable on narrow screens instead of replacing it with an ellipsis. */}
          <p className="break-words text-xl font-medium tracking-tight sm:text-2xl">
            {accountHandle}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
