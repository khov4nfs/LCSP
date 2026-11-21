import type { Request } from "express";
import type { RbacRequestContext } from "./rbac-request.interface.js";

type ExpressRoutePath = string | RegExp | Array<string | RegExp>;

type ExpressRoute = {
  path?: ExpressRoutePath;
};

export type AuthenticatedRequest = Omit<Request, "params" | "route"> & {
  rbacContext: RbacRequestContext;
  correlationId?: string;
  params: Record<string, string | undefined>;
  route?: ExpressRoute;
  user?: {
    id: string;
  };
};
