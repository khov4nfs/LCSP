import Image from "next/image";

import { cn } from "@/lib/utils";

import {
  LCSP_LOGO_SIZES,
  LCSP_LOGO_VARIANTS,
  type LCSPLogoProps,
  type LCSPLogoSize,
  type LCSPLogoVariant,
} from "../types/lcsp-logo.types";

const LOGO_ASSETS = {
  [LCSP_LOGO_VARIANTS.mark]: {
    light: "/brand/lcsp-mark-light.svg",
    dark: "/brand/lcsp-mark-dark.svg",
    width: 32,
    height: 32,
  },
  [LCSP_LOGO_VARIANTS.lockup]: {
    light: "/brand/lcsp-lockup-light.svg",
    dark: "/brand/lcsp-lockup-dark.svg",
    width: 78,
    height: 32,
  },
} as const;

const LOGO_DIMENSIONS: Record<
  LCSPLogoVariant,
  Record<LCSPLogoSize, { width: number; height: number }>
> = {
  [LCSP_LOGO_VARIANTS.mark]: {
    [LCSP_LOGO_SIZES.sm]: { width: 20, height: 20 },
    [LCSP_LOGO_SIZES.md]: { width: 32, height: 32 },
    [LCSP_LOGO_SIZES.lg]: { width: 40, height: 40 },
  },
  [LCSP_LOGO_VARIANTS.lockup]: {
    [LCSP_LOGO_SIZES.sm]: { width: 59, height: 24 },
    [LCSP_LOGO_SIZES.md]: { width: 78, height: 32 },
    [LCSP_LOGO_SIZES.lg]: { width: 98, height: 40 },
  },
};

export function LCSPLogo({
  variant = LCSP_LOGO_VARIANTS.lockup,
  size = LCSP_LOGO_SIZES.md,
  className,
  decorative = true,
  label,
}: LCSPLogoProps) {
  const asset = LOGO_ASSETS[variant];
  const dimensions = LOGO_DIMENSIONS[variant][size];
  const accessibilityProps = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": label } as const);

  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      data-brand-logo={variant}
      style={{ width: dimensions.width, height: dimensions.height }}
      {...accessibilityProps}
    >
      <Image
        src={asset.light}
        width={asset.width}
        height={asset.height}
        alt=""
        aria-hidden="true"
        unoptimized
        className="absolute inset-0 block size-full dark:hidden"
      />
      <Image
        src={asset.dark}
        width={asset.width}
        height={asset.height}
        alt=""
        aria-hidden="true"
        unoptimized
        className="absolute inset-0 hidden size-full dark:block"
      />
    </span>
  );
}
