export const AO6_AGENTIC_TOOL_NAMES = {
  getAdminSourceCatalog: "get_admin_source_catalog",
} as const;

export type Ao6AgenticToolName =
  (typeof AO6_AGENTIC_TOOL_NAMES)[keyof typeof AO6_AGENTIC_TOOL_NAMES];

export const AO6_AGENTIC_TOOL_EVENT_TYPES = {
  adminSourceCatalogRead: "AGENTIC_TOOL_ADMIN_SOURCE_CATALOG_READ",
} as const;

export type Ao6AgenticToolEventType =
  (typeof AO6_AGENTIC_TOOL_EVENT_TYPES)[keyof typeof AO6_AGENTIC_TOOL_EVENT_TYPES];
