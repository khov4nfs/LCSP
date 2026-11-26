export const DASHBOARD_SURFACES = {
  dark: "dark",
  light: "light",
} as const;

export type DashboardSurface =
  (typeof DASHBOARD_SURFACES)[keyof typeof DASHBOARD_SURFACES];

export type CoverageDonutSegment = {
  key: string;
  label: string;
  count: number;
  color: string;
};

export type CoverageDonutProps = {
  segments: readonly CoverageDonutSegment[];
  total: number;
  centerValue: string | number;
  centerLabel: string;
  size?: number;
  strokeWidth?: number;
  surface?: DashboardSurface;
  ariaLabel?: string;
  className?: string;
};

export type OutcomeLegendItem = {
  key: string;
  label: string;
  count: number;
  color: string;
};

export type OutcomeLegendProps = {
  items: readonly OutcomeLegendItem[];
  denominator: number;
  surface?: DashboardSurface;
  locale?: string;
  className?: string;
};

export const NEXT_METRIC_VARIANTS = {
  embedded: "embedded",
  attention: "attention",
  ready: "ready",
} as const;

export type NextMetricVariant =
  (typeof NEXT_METRIC_VARIANTS)[keyof typeof NEXT_METRIC_VARIANTS];

export type NextMetricCardProps = {
  label: string;
  value: string | number;
  context: string;
  variant?: NextMetricVariant;
  href?: string;
  onAction?: () => void;
  ariaLabel?: string;
  className?: string;
};
