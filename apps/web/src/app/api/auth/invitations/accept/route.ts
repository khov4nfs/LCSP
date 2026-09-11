import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";
/** No role or session is synthesized. The API consumes the invitation atomically. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  return upstreamJson(
    await upstreamRequest("/auth/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
