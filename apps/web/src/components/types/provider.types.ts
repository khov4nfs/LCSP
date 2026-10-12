import type { ReactNode } from "react";
import type { Locale } from "@lcsp/contracts/shared";

export type QueryProviderProps = {
  children: ReactNode;
};

export type LocaleProviderProps = {
  children: ReactNode;
  initialLocale?: Locale;
};
