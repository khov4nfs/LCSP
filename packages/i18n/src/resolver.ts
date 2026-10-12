import type { Locale } from "@lcsp/contracts/shared/locale";

import { defaultMessages } from "./schema.ts";
import { enAuth, enCommon, enPages, enAssessment } from "./locales/en/index.ts";
import { viAuth, viCommon, viPages, viAssessment } from "./locales/vi/index.ts";

const dictionaries = {
  en: {
    assessment: enAssessment,
    auth: enAuth,
    common: enCommon,
    pages: enPages,
  },
  vi: {
    assessment: viAssessment,
    auth: viAuth,
    common: viCommon,
    pages: viPages,
  },
} as const;

export type MessageKey = ExtractMessageKey<typeof defaultMessages>;

type ExtractMessageKey<
  TValue,
  TPrefix extends string = "",
> = TValue extends string
  ? TPrefix
  : TValue extends Record<string, unknown>
    ? {
        [TKey in keyof TValue & string]: ExtractMessageKey<
          TValue[TKey],
          TPrefix extends "" ? TKey : `${TPrefix}.${TKey}`
        >;
      }[keyof TValue & string]
    : never;

export function resolveMessage(locale: Locale, key: MessageKey): string {
  const dictionary = dictionaries[locale] ?? dictionaries.en;
  const segments = key.split(".");
  let cursor: unknown = dictionary;

  for (const segment of segments) {
    if (typeof cursor !== "object" || cursor == null || !(segment in cursor)) {
      return key;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return typeof cursor === "string" ? cursor : key;
}

export { defaultMessages };
