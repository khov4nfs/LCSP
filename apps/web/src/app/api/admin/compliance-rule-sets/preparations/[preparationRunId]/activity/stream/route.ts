// Keep the route declarative; validation, auth and streaming live in the server-only proxy.
export { proxyPreparationActivityStream as GET } from "@/lib/server/preparation-activity-stream-proxy";

export const dynamic = "force-dynamic";
