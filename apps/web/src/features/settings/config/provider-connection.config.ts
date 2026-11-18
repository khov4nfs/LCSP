import type { MessageKey } from "@lcsp/i18n";

export const PROVIDER_CONNECTION_STATES = {
  connected: "connected",
  expired: "expired",
  attention: "attention",
  notConnected: "notConnected",
} as const;

export type ProviderConnectionState =
  (typeof PROVIDER_CONNECTION_STATES)[keyof typeof PROVIDER_CONNECTION_STATES];

export const PROVIDER_CONNECTION_LABEL_KEYS = {
  [PROVIDER_CONNECTION_STATES.connected]:
    "pages.workspace.settingsHub.repositories.connected",
  [PROVIDER_CONNECTION_STATES.expired]:
    "pages.workspace.settingsHub.repositories.connectionExpired",
  [PROVIDER_CONNECTION_STATES.attention]:
    "pages.workspace.settingsHub.repositories.connectionNeedsAttention",
  [PROVIDER_CONNECTION_STATES.notConnected]:
    "pages.workspace.settingsHub.repositories.notConnected",
} as const satisfies Record<ProviderConnectionState, MessageKey>;

export const PROVIDER_CONNECTION_TONE_CLASSES = {
  [PROVIDER_CONNECTION_STATES.connected]: "text-primary",
  [PROVIDER_CONNECTION_STATES.expired]: "text-destructive",
  [PROVIDER_CONNECTION_STATES.attention]: "text-destructive",
  [PROVIDER_CONNECTION_STATES.notConnected]: "text-muted-foreground",
} as const satisfies Record<ProviderConnectionState, string>;
