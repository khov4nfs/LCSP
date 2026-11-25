"use client";

export const CHAT_FONTS = {
  inter: "inter",
  mono: "mono",
} as const;

export type ChatFont = (typeof CHAT_FONTS)[keyof typeof CHAT_FONTS];

export const CHAT_FONT_COOKIE = "lcsp_chat_font";
export const NOTIFY_COMPLETION_COOKIE = "lcsp_notify_assessment_completion";

let currentChatFont: ChatFont = CHAT_FONTS.inter;
let currentNotifyCompletion = true;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.split("=")[1] ?? null : null;
}

function initializePreferences() {
  if (typeof document === "undefined") return;
  const font = readCookie(CHAT_FONT_COOKIE);
  if (font === CHAT_FONTS.inter || font === CHAT_FONTS.mono) {
    currentChatFont = font;
  }
  const notify = readCookie(NOTIFY_COMPLETION_COOKIE);
  if (notify !== null) {
    currentNotifyCompletion = notify === "true";
  }
}

initializePreferences();

/**
 * Business purpose: Read the active chat font preference snapshot for reactive React subscriptions.
 *
 * Business rules:
 * - Returns 'inter' as the default standard font.
 * - Read-only synchronous snapshot for useSyncExternalStore.
 *
 * Execution flow:
 * 1. Return the current in-memory chat font state.
 *
 * Failure cases:
 * - None: always returns a valid ChatFont constant.
 *
 * Side effects:
 * - None: pure read.
 */
export function getChatFontSnapshot(): ChatFont {
  return currentChatFont;
}

/**
 * Business purpose: Subscribe to reactive updates when the user modifies their chat font preference.
 *
 * Business rules:
 * - Subscribes to the window custom event 'lcsp:chat-font-change'.
 * - Cleanly unsubscribes on listener disposal.
 *
 * Execution flow:
 * 1. Register event listener on global window.
 * 2. Return cleanup function to remove event listener.
 *
 * Failure cases:
 * - None: no-op in non-browser environments.
 *
 * Side effects:
 * - Adds and removes a DOM event listener on window.
 */
export function subscribeToChatFont(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("lcsp:chat-font-change", onStoreChange);
  return () => window.removeEventListener("lcsp:chat-font-change", onStoreChange);
}

/**
 * Business purpose: Update the customer chat font preference and persist it across browser sessions.
 *
 * Business rules:
 * - Only supported CHAT_FONTS values are accepted.
 * - Persists to browser cookie for 1 year with SameSite=Lax.
 * - Dispatches 'lcsp:chat-font-change' event to notify reactive UI consumers.
 *
 * Execution flow:
 * 1. Validate font value against known CHAT_FONTS constants.
 * 2. Update in-memory state.
 * 3. Persist to cookie if executing in browser context.
 * 4. Dispatch notification event to reactive subscribers.
 *
 * Failure cases:
 * - Unsupported font identifiers are ignored without mutating state.
 *
 * Side effects:
 * - Mutates document.cookie and emits a custom DOM event on window.
 */
export function setChatFont(font: ChatFont): void {
  if (font !== CHAT_FONTS.inter && font !== CHAT_FONTS.mono) return;
  currentChatFont = font;
  if (typeof document !== "undefined") {
    document.cookie = `${CHAT_FONT_COOKIE}=${font}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event("lcsp:chat-font-change"));
  }
}

/**
 * Business purpose: Read the active assessment completion notification preference snapshot.
 *
 * Business rules:
 * - Defaults to true (notifications enabled).
 * - Read-only synchronous snapshot for useSyncExternalStore.
 *
 * Execution flow:
 * 1. Return current in-memory notification preference state.
 *
 * Failure cases:
 * - None: always returns a valid boolean value.
 *
 * Side effects:
 * - None: pure read.
 */
export function getAssessmentCompletionNotificationSnapshot(): boolean {
  return currentNotifyCompletion;
}

/**
 * Business purpose: Subscribe to reactive updates when the user toggles assessment completion notifications.
 *
 * Business rules:
 * - Subscribes to the window custom event 'lcsp:notification-preference-change'.
 * - Cleanly unsubscribes on listener disposal.
 *
 * Execution flow:
 * 1. Register event listener on global window.
 * 2. Return cleanup function to remove event listener.
 *
 * Failure cases:
 * - None: no-op in non-browser environments.
 *
 * Side effects:
 * - Adds and removes a DOM event listener on window.
 */
export function subscribeToAssessmentCompletionNotification(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(
    "lcsp:notification-preference-change",
    onStoreChange,
  );
  return () =>
    window.removeEventListener(
      "lcsp:notification-preference-change",
      onStoreChange,
    );
}

/**
 * Business purpose: Update the customer assessment completion notification preference and persist it.
 *
 * Business rules:
 * - Accepts boolean enabled state.
 * - Persists to browser cookie for 1 year with SameSite=Lax.
 * - Dispatches 'lcsp:notification-preference-change' event to notify UI consumers.
 *
 * Execution flow:
 * 1. Update in-memory state with new boolean value.
 * 2. Persist to cookie if executing in browser context.
 * 3. Dispatch notification event to reactive subscribers.
 *
 * Failure cases:
 * - None.
 *
 * Side effects:
 * - Mutates document.cookie and emits a custom DOM event on window.
 */
export function setAssessmentCompletionNotificationPreference(
  enabled: boolean,
): void {
  currentNotifyCompletion = enabled;
  if (typeof document !== "undefined") {
    document.cookie = `${NOTIFY_COMPLETION_COOKIE}=${enabled}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event("lcsp:notification-preference-change"));
  }
}
