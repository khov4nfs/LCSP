import { ListAdminUsersHandler } from "./list-admin-users/list-admin-users.handler.js";
import { GetAdminUserDetailHandler } from "./get-admin-user-detail/get-admin-user-detail.handler.js";
import { GetAdminOverviewHandler } from "./get-admin-overview/get-admin-overview.handler.js";

export * from "./list-admin-users/list-admin-users.query.js";
export * from "./list-admin-users/list-admin-users.handler.js";
export * from "./get-admin-user-detail/get-admin-user-detail.query.js";
export * from "./get-admin-user-detail/get-admin-user-detail.handler.js";
export * from "./get-admin-overview/get-admin-overview.query.js";
export * from "./get-admin-overview/get-admin-overview.handler.js";

export const ADMIN_QUERY_HANDLERS = [
  ListAdminUsersHandler,
  GetAdminUserDetailHandler,
  GetAdminOverviewHandler,
] as const;
