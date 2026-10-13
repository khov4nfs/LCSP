"use client";

import { useSyncExternalStore } from "react";
import { ADMIN_DESKTOP_MEDIA_QUERY } from "../config/admin-sidebar.config";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(ADMIN_DESKTOP_MEDIA_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useAdminDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(ADMIN_DESKTOP_MEDIA_QUERY).matches,
    () => true,
  );
}
