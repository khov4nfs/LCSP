export const LCSP_LOGO_VARIANTS = {
  mark: "mark",
  lockup: "lockup",
} as const;

export type LCSPLogoVariant =
  (typeof LCSP_LOGO_VARIANTS)[keyof typeof LCSP_LOGO_VARIANTS];

export const LCSP_LOGO_SIZES = {
  sm: "sm",
  md: "md",
  lg: "lg",
} as const;

export type LCSPLogoSize =
  (typeof LCSP_LOGO_SIZES)[keyof typeof LCSP_LOGO_SIZES];

export type LCSPLogoProps = {
  variant?: LCSPLogoVariant;
  size?: LCSPLogoSize;
  className?: string;
  decorative?: boolean;
  label?: string;
};
