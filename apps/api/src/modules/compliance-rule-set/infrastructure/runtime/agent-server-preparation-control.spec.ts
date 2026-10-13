import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  AgentServerPreparationControl,
  preparationThreadId,
} from "./agent-server-preparation-control.js";

const ORIGINAL_URL = process.env.LCSP_AGENT_SERVER_URL;

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.LCSP_AGENT_SERVER_URL;
  else process.env.LCSP_AGENT_SERVER_URL = ORIGINAL_URL;
  jest.restoreAllMocks();
});

describe("Agent Server preparation cancellation", () => {
  it("derives the canonical thread and cancels the one active native run", async () => {
    process.env.LCSP_AGENT_SERVER_URL = "http://127.0.0.1:2024";
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json([{ run_id: "native-run-1", status: "running" }]),
      )
      .mockResolvedValueOnce(Response.json({ status: "running" }));

    await new AgentServerPreparationControl().cancel("correlation-a");

    const threadId = "0f134c03-ac7d-5b0d-957d-6eea40cf9455";
    expect(preparationThreadId("correlation-a")).toBe(threadId);
    const listUrl = fetchMock.mock.calls[0]?.[0];
    const cancelUrl = fetchMock.mock.calls[1]?.[0];
    expect(listUrl).toBeInstanceOf(URL);
    expect(cancelUrl).toBeInstanceOf(URL);
    if (!(listUrl instanceof URL) || !(cancelUrl instanceof URL))
      throw new Error("Agent Server requests must use canonical URLs");
    expect(listUrl.href).toBe(
      `http://127.0.0.1:2024/threads/${threadId}/runs?limit=100`,
    );
    expect(cancelUrl.href).toBe(
      `http://127.0.0.1:2024/threads/${threadId}/runs/native-run-1/cancel`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cancel completed or absent native runs", async () => {
    process.env.LCSP_AGENT_SERVER_URL = "http://127.0.0.1:2024";
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json([{ run_id: "native-run-1", status: "success" }]),
      );

    await new AgentServerPreparationControl().cancel("correlation-a");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses ambiguous active native runs instead of cancelling an arbitrary one", async () => {
    process.env.LCSP_AGENT_SERVER_URL = "http://127.0.0.1:2024";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json([
        { run_id: "native-run-1", status: "running" },
        { run_id: "native-run-2", status: "pending" },
      ]),
    );

    await expect(
      new AgentServerPreparationControl().cancel("correlation-a"),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
