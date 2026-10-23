import { describe, expect, it, jest } from "@jest/globals";
import {
  LEGAL_SOURCE_IMPORT_REJECTION_REASONS as Reasons,
  LEGAL_SOURCE_LIMITS,
  LEGAL_SOURCE_MEDIA_TYPES,
} from "@lcsp/contracts/legal-source";

import {
  ImportRejectedError,
  NodeSafeFetchTransport,
  SafeUrlFetcherService,
  isPublicAddress,
  parseImportUrl,
  type ResolvedAddress,
  type SafeFetchResponse,
} from "./safe-url-fetcher.service.js";

const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };

type Hop = { addresses?: ResolvedAddress[]; response?: SafeFetchResponse };

function fetcherWith(hops: Hop[]) {
  const resolve = jest.fn<NodeSafeFetchTransport["resolve"]>();
  const get = jest.fn<NodeSafeFetchTransport["get"]>();
  for (const hop of hops) {
    resolve.mockResolvedValueOnce(hop.addresses ?? [PUBLIC]);
    if (hop.response) get.mockResolvedValueOnce(hop.response);
  }
  const transport = { resolve, get } as unknown as NodeSafeFetchTransport;
  return { fetcher: new SafeUrlFetcherService(transport), resolve, get };
}

const ok = (
  contentType: string | undefined,
  body: Buffer | string = "document text",
  extra: Record<string, string> = {},
): SafeFetchResponse => ({
  status: 200,
  headers: { "content-type": contentType, ...extra },
  body: Buffer.from(body),
});

const redirect = (location: string): SafeFetchResponse => ({
  status: 302,
  headers: { location },
  body: Buffer.alloc(0),
});

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImportRejectedError) return error.reason;
    throw error;
  }
  return "ACCEPTED";
}

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "not-an-address",
  ])("rejects %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts the public address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it("treats the edges of private ranges exactly", () => {
    expect(isPublicAddress("172.15.255.255")).toBe(true);
    expect(isPublicAddress("172.32.0.0")).toBe(true);
    expect(isPublicAddress("100.63.255.255")).toBe(true);
    expect(isPublicAddress("100.128.0.0")).toBe(true);
  });
});

describe("parseImportUrl", () => {
  it.each([
    ["not a url", Reasons.INVALID_URL],
    ["http://example.com/a.pdf", Reasons.SCHEME_NOT_HTTPS],
    ["ftp://example.com/a.pdf", Reasons.SCHEME_NOT_HTTPS],
    ["file:///etc/passwd", Reasons.SCHEME_NOT_HTTPS],
    ["https://user:pw@example.com/a.pdf", Reasons.CREDENTIALS_IN_URL],
    ["https://user@example.com/a.pdf", Reasons.CREDENTIALS_IN_URL],
    ["https://example.com:8443/a.pdf", Reasons.PORT_NOT_ALLOWED],
    ["https://example.com:22/a.pdf", Reasons.PORT_NOT_ALLOWED],
    ["https://127.0.0.1/a.pdf", Reasons.HOST_IS_ADDRESS],
    ["https://169.254.169.254/latest/meta-data", Reasons.HOST_IS_ADDRESS],
    ["https://[::1]/a.pdf", Reasons.HOST_IS_ADDRESS],
    ["https://[::ffff:10.0.0.1]/a.pdf", Reasons.HOST_IS_ADDRESS],
    ["https://2130706433/a.pdf", Reasons.HOST_IS_ADDRESS],
  ])("rejects %s", (url, reason) => {
    expect(() => parseImportUrl(url)).toThrow(
      expect.objectContaining({ reason }),
    );
  });

  it("accepts a plain https host name, with or without the default port", () => {
    expect(parseImportUrl("https://example.com/law.pdf").hostname).toBe(
      "example.com",
    );
    expect(parseImportUrl("https://example.com:443/law.pdf").hostname).toBe(
      "example.com",
    );
  });
});

describe("SafeUrlFetcherService", () => {
  it("returns the bytes with provenance and never reaches the network twice for one hop", async () => {
    const { fetcher, get } = fetcherWith([
      {
        response: ok(
          LEGAL_SOURCE_MEDIA_TYPES.PDF + "; charset=binary",
          "%PDF-1.7 body",
          {
            etag: '"abc"',
            "last-modified": "Tue, 13 Oct 2026 10:00:00 GMT",
            "content-disposition": 'attachment; filename="law-134.pdf"',
          },
        ),
      },
    ]);

    const result = await fetcher.fetch("https://example.com/files/x");

    expect(result.bytes.toString()).toBe("%PDF-1.7 body");
    expect(result.contentType).toBe(LEGAL_SOURCE_MEDIA_TYPES.PDF);
    expect(result.requestedUrl).toBe("https://example.com/files/x");
    expect(result.finalUrl).toBe("https://example.com/files/x");
    expect(result.etag).toBe('"abc"');
    expect(result.lastModified).toBe("Tue, 13 Oct 2026 10:00:00 GMT");
    expect(result.fileName).toBe("law-134.pdf");
    expect(result.redirects).toBe(0);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("derives the file name from the URL path when the server names none", async () => {
    const { fetcher } = fetcherWith([
      { response: ok("text/html", "<html></html>") },
    ]);
    const result = await fetcher.fetch("https://example.com/laws/134.html");
    expect(result.fileName).toBe("134.html");
  });

  it("treats a generic binary type as undeclared so the caller sniffs the bytes", async () => {
    const { fetcher } = fetcherWith([
      { response: ok("application/octet-stream", "%PDF-1.4") },
    ]);
    expect(
      (await fetcher.fetch("https://example.com/x")).contentType,
    ).toBeNull();
  });

  it("never connects when the host resolves to a private address", async () => {
    const { fetcher, get } = fetcherWith([
      { addresses: [{ address: "10.0.0.5", family: 4 }] },
    ]);
    expect(
      await reasonOf(fetcher.fetch("https://internal.example.com/x")),
    ).toBe(Reasons.ADDRESS_NOT_PUBLIC);
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects the whole host when only one of several addresses is private", async () => {
    const { fetcher, get } = fetcherWith([
      {
        addresses: [PUBLIC, { address: "169.254.169.254", family: 4 }],
      },
    ]);
    expect(await reasonOf(fetcher.fetch("https://mixed.example.com/x"))).toBe(
      Reasons.ADDRESS_NOT_PUBLIC,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects a host that resolves to an IPv4-mapped loopback", async () => {
    const { fetcher } = fetcherWith([
      { addresses: [{ address: "::ffff:127.0.0.1", family: 6 }] },
    ]);
    expect(await reasonOf(fetcher.fetch("https://mapped.example.com/x"))).toBe(
      Reasons.ADDRESS_NOT_PUBLIC,
    );
  });

  it("rejects a host that does not resolve", async () => {
    const { fetcher } = fetcherWith([{ addresses: [] }]);
    expect(await reasonOf(fetcher.fetch("https://nowhere.example.com/x"))).toBe(
      Reasons.HOST_NOT_RESOLVABLE,
    );
  });

  it("pins the connection to the validated address", async () => {
    const { fetcher, get } = fetcherWith([{ response: ok("text/plain") }]);
    await fetcher.fetch("https://example.com/x");
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        address: PUBLIC,
        maxBytes: LEGAL_SOURCE_LIMITS.maxDocumentBytes,
      }),
    );
  });

  it("follows a redirect to another public host and records the final URL", async () => {
    const { fetcher, get } = fetcherWith([
      { response: redirect("https://cdn.example.org/real.pdf") },
      { response: ok(LEGAL_SOURCE_MEDIA_TYPES.PDF, "%PDF-") },
    ]);
    const result = await fetcher.fetch("https://example.com/short");
    expect(result.finalUrl).toBe("https://cdn.example.org/real.pdf");
    expect(result.requestedUrl).toBe("https://example.com/short");
    expect(result.redirects).toBe(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("resolves a relative redirect against the current URL", async () => {
    const { fetcher } = fetcherWith([
      { response: redirect("/final.html") },
      { response: ok("text/html", "<html/>") },
    ]);
    const result = await fetcher.fetch("https://example.com/a/b");
    expect(result.finalUrl).toBe("https://example.com/final.html");
  });

  it.each([
    ["http://example.com/x", Reasons.REDIRECT_REJECTED],
    ["https://127.0.0.1/x", Reasons.REDIRECT_REJECTED],
    ["https://user:pw@example.com/x", Reasons.REDIRECT_REJECTED],
    ["https://example.com:9000/x", Reasons.REDIRECT_REJECTED],
  ])("rejects a redirect to %s", async (location, reason) => {
    const { fetcher } = fetcherWith([{ response: redirect(location) }]);
    expect(await reasonOf(fetcher.fetch("https://example.com/x"))).toBe(reason);
  });

  it("revalidates the redirect target's addresses", async () => {
    const { fetcher, get } = fetcherWith([
      { response: redirect("https://rebind.example.net/x") },
      { addresses: [{ address: "192.168.0.10", family: 4 }] },
    ]);
    expect(await reasonOf(fetcher.fetch("https://example.com/x"))).toBe(
      Reasons.ADDRESS_NOT_PUBLIC,
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("stops after three redirects", async () => {
    const { fetcher } = fetcherWith([
      { response: redirect("https://a.example.com/1") },
      { response: redirect("https://a.example.com/2") },
      { response: redirect("https://a.example.com/3") },
      { response: redirect("https://a.example.com/4") },
    ]);
    expect(await reasonOf(fetcher.fetch("https://example.com/0"))).toBe(
      Reasons.TOO_MANY_REDIRECTS,
    );
  });

  it("rejects a redirect without a target", async () => {
    const { fetcher } = fetcherWith([
      { response: { status: 302, headers: {}, body: Buffer.alloc(0) } },
    ]);
    expect(await reasonOf(fetcher.fetch("https://example.com/x"))).toBe(
      Reasons.REDIRECT_REJECTED,
    );
  });

  it("rejects a non-200 answer", async () => {
    const { fetcher } = fetcherWith([
      { response: { status: 404, headers: {}, body: Buffer.from("no") } },
    ]);
    expect(await reasonOf(fetcher.fetch("https://example.com/x"))).toBe(
      Reasons.RESPONSE_NOT_OK,
    );
  });

  it.each([
    "application/zip",
    "image/png",
    "application/x-msdownload",
    "application/javascript",
  ])("rejects the content type %s", async (type) => {
    const { fetcher } = fetcherWith([{ response: ok(type) }]);
    expect(await reasonOf(fetcher.fetch("https://example.com/x"))).toBe(
      Reasons.CONTENT_TYPE_NOT_ALLOWED,
    );
  });

  it("rejects an empty body", async () => {
    const { fetcher } = fetcherWith([{ response: ok("text/plain", "") }]);
    expect(await reasonOf(fetcher.fetch("https://example.com/x"))).toBe(
      Reasons.RESPONSE_EMPTY,
    );
  });

  it("tries the next validated address when a connection fails", async () => {
    const second: ResolvedAddress = { address: "93.184.216.35", family: 4 };
    const resolve = jest
      .fn<NodeSafeFetchTransport["resolve"]>()
      .mockResolvedValue([PUBLIC, second]);
    const get = jest
      .fn<NodeSafeFetchTransport["get"]>()
      .mockRejectedValueOnce(new ImportRejectedError(Reasons.CONNECTION_FAILED))
      .mockResolvedValueOnce(ok("text/plain"));
    const fetcher = new SafeUrlFetcherService({
      resolve,
      get,
    });

    await fetcher.fetch("https://example.com/x");

    expect(get.mock.calls.map(([input]) => input.address)).toEqual([
      PUBLIC,
      second,
    ]);
  });

  it("does not retry on another address after a size or timeout rejection", async () => {
    const resolve = jest
      .fn<NodeSafeFetchTransport["resolve"]>()
      .mockResolvedValue([PUBLIC, { address: "93.184.216.35", family: 4 }]);
    const get = jest
      .fn<NodeSafeFetchTransport["get"]>()
      .mockRejectedValue(new ImportRejectedError(Reasons.RESPONSE_TOO_LARGE));
    const fetcher = new SafeUrlFetcherService({
      resolve,
      get,
    });

    expect(await reasonOf(fetcher.fetch("https://example.com/x"))).toBe(
      Reasons.RESPONSE_TOO_LARGE,
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("surfaces a connection failure when every address fails", async () => {
    const resolve = jest
      .fn<NodeSafeFetchTransport["resolve"]>()
      .mockResolvedValue([PUBLIC]);
    const get = jest
      .fn<NodeSafeFetchTransport["get"]>()
      .mockRejectedValue(new ImportRejectedError(Reasons.CONNECTION_FAILED));
    const fetcher = new SafeUrlFetcherService({
      resolve,
      get,
    });
    expect(await reasonOf(fetcher.fetch("https://example.com/x"))).toBe(
      Reasons.CONNECTION_FAILED,
    );
  });
});
