export const THEME_PREFERENCES = {
  light: "light",
  dark: "dark",
  system: "system",
} as const;

export type ThemePreference =
  (typeof THEME_PREFERENCES)[keyof typeof THEME_PREFERENCES];

export const RESOLVED_THEMES = {
  light: "light",
  dark: "dark",
} as const;

export type ResolvedTheme =
  (typeof RESOLVED_THEMES)[keyof typeof RESOLVED_THEMES];
