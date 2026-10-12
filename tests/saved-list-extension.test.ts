import { afterEach, describe, expect, it, vi } from "vitest";
import { OdaClient } from "../src/oda-client.js";

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const list = (items: [number, number][] = [], extra = {}) => ({
  id: 12,
  title: "Test list",
  description: "Test description",
  items: items.map(([id, quantity]) => ({
    product: { id, full_name: `Product ${id}` },
    quantity,
  })),
  ...extra,
});
const client = () => new OdaClient("/nonexistent/cookies.json");
afterEach(() => vi.unstubAllGlobals());

describe("create saved list", () => {
  it("sends website metadata and returns verified normalized fields", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 12, secret: "private" }))
      .mockResolvedValueOnce(
        response(list([], { url: "https://oda.com/shared/private-token" })),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await client().createSavedList(
      " Test list ",
      "Test description",
    );
    expect(result.id).toBe(12);
    expect(result.url).toBe("https://oda.com/no/account/lists/details/12/");
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://oda.com/api/v1/product-lists/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      title: "Test list",
      description: "Test description",
    });
    expect(init.headers.Referer).toBe("https://oda.com/no/account/lists/");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["", "   ", "x".repeat(256)])(
    "rejects invalid titles before HTTP",
    async (title) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(client().createSavedList(title)).rejects.toThrow(/title/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("uses an empty description when omitted", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 12 }))
      .mockResolvedValueOnce(response(list([], { description: "" })));
    vi.stubGlobal("fetch", fetch);
    await client().createSavedList("Test list");
    expect(JSON.parse(fetch.mock.calls[0][1].body).description).toBe("");
  });
  it("does not retry a lost create response or expose the raw error", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new Error("secret transport details"));
    vi.stubGlobal("fetch", fetch);
    await expect(client().createSavedList("Test list")).rejects.toThrow(
      /^Create saved list outcome unknown\. Check saved lists before retrying\.$/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 400, 500])(
    "reports HTTP %i without raw response data or retry",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(response({ secret: "private" }, status));
      vi.stubGlobal("fetch", fetch);
      await expect(client().createSavedList("Test list")).rejects.toThrow(
        `HTTP ${status}. Check saved lists before retrying.`,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([{}, { id: 0 }, { id: 1.5 }, { id: "bad" }])(
    "handles unusable creation responses",
    async (data) => {
      const fetch = vi.fn().mockResolvedValue(response(data));
      vi.stubGlobal("fetch", fetch);
      await expect(client().createSavedList("Test list")).rejects.toThrow(
        /no usable ID/,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("reports the created ID if verification fails without creating again", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 12 }))
      .mockRejectedValueOnce(new Error("private"));
    vi.stubGlobal("fetch", fetch);
    await expect(client().createSavedList("Test list")).rejects.toThrow(
      /List 12 was created but could not be verified/,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not claim verification for mismatched metadata", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 12 }))
      .mockResolvedValueOnce(response(list([], { title: "Wrong" })));
    vi.stubGlobal("fetch", fetch);
    await expect(client().createSavedList("Test list")).rejects.toThrow(
      /could not be verified/,
    );
  });
});

describe("replace saved-list product", () => {
  it("does not write when preflight fails and omits raw private responses", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ detail: "private" }, 403));
    vi.stubGlobal("fetch", fetch);
    await expect(
      client().replaceProductInSavedList(12, 34, 56),
    ).rejects.toThrow(
      /^Could not read saved list\. No replacement was attempted; check login and list access\.$/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, 5])(
    "replaces in one write and verifies quantity %s",
    async (quantity) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(list([[34, 2]])))
        .mockResolvedValueOnce(response({}))
        .mockResolvedValueOnce(response(list([[56, quantity ?? 2]])));
      vi.stubGlobal("fetch", fetch);
      const result = await client().replaceProductInSavedList(
        12,
        34,
        56,
        quantity,
      );
      expect(result.status).toBe("verified");
      expect(result.observed).toEqual({
        old_quantities: [],
        new_quantities: [quantity ?? 2],
      });
      const [url, init] = fetch.mock.calls[1];
      expect(url).toBe("https://oda.com/api/v1/product-lists/12/products/");
      expect(JSON.parse(init.body)).toEqual([
        { productId: 34, delete: true, quantity: 2 },
        { productId: 56, quantity: quantity ?? 2 },
      ]);
      expect(init.headers.Referer).toBe(
        "https://oda.com/no/account/lists/details/12/",
      );
      expect(
        fetch.mock.calls.filter(([, init]) => init.method === "POST"),
      ).toHaveLength(1);
    },
  );
  it.each([
    [0, 34, 56, undefined],
    [12, -1, 56, undefined],
    [12, 34, 1.5, undefined],
    [12, 34, 34, undefined],
    [12, 34, 56, 0],
    [12, 34, 56, -1],
    [12, 34, 56, 1.5],
  ])(
    "rejects invalid arguments %s %s %s %s without HTTP",
    async (id, old, replacement, quantity) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(
        client().replaceProductInSavedList(id!, old!, replacement!, quantity),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    { items: [] as [number, number][], error: /exactly once/ },
    {
      items: [
        [34, 2],
        [34, 2],
      ] as [number, number][],
      error: /exactly once/,
    },
    {
      items: [
        [34, 2],
        [56, 1],
      ] as [number, number][],
      error: /already in the list/,
    },
    { items: [[34, 0]] as [number, number][], error: /Source quantity/ },
  ])(
    "rejects unsafe starting state $items without a write",
    async ({ items, error }) => {
      const fetch = vi.fn().mockResolvedValue(response(list(items)));
      vi.stubGlobal("fetch", fetch);
      await expect(
        client().replaceProductInSavedList(12, 34, 56),
      ).rejects.toThrow(error);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("checks state after a timed-out write, reporting observed success without retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(list([[34, 2]])))
      .mockRejectedValueOnce(new Error("secret timeout"))
      .mockResolvedValueOnce(response(list([[56, 2]])));
    vi.stubGlobal("fetch", fetch);
    expect(await client().replaceProductInSavedList(12, 34, 56)).toMatchObject({
      status: "verified",
      request_status: "failed_or_unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each([
    [[34, 2]],
    [],
    [
      [34, 2],
      [56, 2],
    ],
    [[56, 1]],
  ])("reports partial/unchanged state as uncertain: %j", async (...items) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(list([[34, 2]])))
      .mockResolvedValueOnce(response({ error: "private" }, 400))
      .mockResolvedValueOnce(response(list(items as [number, number][])));
    vi.stubGlobal("fetch", fetch);
    const result = await client().replaceProductInSavedList(12, 34, 56);
    expect(result.status).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("reports verification failure without retrying or exposing raw errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(list([[34, 2]])))
      .mockResolvedValueOnce(response({}))
      .mockRejectedValueOnce(new Error("secret"));
    vi.stubGlobal("fetch", fetch);
    expect(await client().replaceProductInSavedList(12, 34, 56)).toMatchObject({
      status: "uncertain",
      observed: null,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
