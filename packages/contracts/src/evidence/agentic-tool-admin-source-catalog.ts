export const ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_NAMES = {
  getAdminSourceCatalog: "get_admin_source_catalog",
} as const;

export type AdminSourceCatalogAgenticToolName =
  (typeof ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_NAMES)[keyof typeof ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_NAMES];

export const ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_EVENT_TYPES = {
  adminSourceCatalogRead: "AGENTIC_TOOL_ADMIN_SOURCE_CATALOG_READ",
} as const;

export type AdminSourceCatalogAgenticToolEventType =
  (typeof ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_EVENT_TYPES)[keyof typeof ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_EVENT_TYPES];
