"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { resolveMessage } from "@lcsp/i18n";
import { toDataURL } from "qrcode";

import { appLocale } from "@/lib/locale";
import type { MfaQrPreviewProps } from "../../types/mfa-enroll.types";

export function MfaQrPreview({ totpUri }: MfaQrPreviewProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void toDataURL(totpUri, {
      errorCorrectionLevel: "medium",
      margin: 1,
      width: 240,
    }).then((dataUrl: string) => {
      if (!cancelled) {
        setQrCodeDataUrl(dataUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [totpUri]);

  if (!qrCodeDataUrl) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        {resolveMessage(appLocale, "pages.mfaEnroll.qrLoading")}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-xs font-semibold tracking-wide text-foreground uppercase">
        {resolveMessage(appLocale, "pages.mfaEnroll.qrTitle")}
      </p>
      <div className="inline-flex rounded-2xl border border-border/80 bg-white p-4 sm:p-5 shadow-xs">
        <Image
          src={qrCodeDataUrl}
          alt={resolveMessage(appLocale, "pages.mfaEnroll.qrAlt")}
          className="size-44 max-w-full sm:size-48"
          width={192}
          height={192}
          unoptimized
        />
      </div>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
        {resolveMessage(appLocale, "pages.mfaEnroll.qrHint")}
      </p>
    </div>
  );
}
