"use client";

import { createContext, useContext } from "react";
import type { Locale } from "@lcsp/contracts/shared/locale";

export const MarketingLocaleContext = createContext<Locale>("en");

export function MarketingLocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <MarketingLocaleContext.Provider value={locale}>
      {children}
    </MarketingLocaleContext.Provider>
  );
}

export function useMarketingLocale() {
  return useContext(MarketingLocaleContext);
}
