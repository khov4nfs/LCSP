"use client";

import { createContext, useContext, useState, useSyncExternalStore } from "react";
import type { Locale } from "@lcsp/contracts/shared";
import type { LocaleProviderProps } from "@/components/types/provider.types";
import {
  getAppLocaleSnapshot,
  initAppLocale,
  subscribeToAppLocale,
} from "@/lib/locale";

const LocaleContext = createContext<Locale>("vi");

export function useAppLocale(): Locale {
  return useContext(LocaleContext);
}

export function LocaleProvider({
  children,
  initialLocale,
}: LocaleProviderProps) {
  useState(() => {
    initAppLocale(initialLocale);
  });

  const currentLocale = useSyncExternalStore(
    subscribeToAppLocale,
    getAppLocaleSnapshot,
    getAppLocaleSnapshot,
  );

  return (
    <LocaleContext.Provider value={currentLocale}>
      <div data-locale={currentLocale} className="contents">
        {children}
      </div>
    </LocaleContext.Provider>
  );
}
