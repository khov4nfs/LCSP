import { appLocale } from "@/lib/locale";

/** 1650000 -> "1.65M": two significant decimals so the sidebar total reads like the ledger. */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat(appLocale, {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}
