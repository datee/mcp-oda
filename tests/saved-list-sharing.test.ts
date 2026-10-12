import { afterEach, describe, expect, it, vi } from "vitest";
import { OdaClient } from "../src/oda-client.js";
import type { SavedListShareAccess } from "../src/types.js";

const view =
  "https://oda.com/no/account/lists/view/12/?pltoken=fake-view-token";
const edit =
  "https://oda.com/no/account/lists/shared/12/?pltoken=fake-edit-token";
const list = {
  id: 12,
  title: "Test list",
  share_url_view_access: view,
  share_url_edit_access: edit,
  share_url: "unused",
  items: [{ private: "not-for-export" }],
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const client = () => new OdaClient("/nonexistent/cookies.json");
afterEach(() => vi.unstubAllGlobals());

describe("saved-list sharing links", () => {
  it.each(["view", "edit"] as const)(
    "returns only the chosen %s URL using one GET",
    async (access) => {
      const fetch = vi.fn().mockResolvedValue(response(list));
      vi.stubGlobal("fetch", fetch);
      const result = await client().getSavedListShareLink(12, access);
      expect(result).toMatchObject({
        list_id: 12,
        title: "Test list",
        access,
        url: access === "view" ? view : edit,
      });
      expect(JSON.stringify(result)).not.toContain(
        access === "view" ? "fake-edit-token" : "fake-view-token",
      );
      expect(JSON.stringify(result)).not.toContain("not-for-export");
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("https://oda.com/api/v1/product-lists/12/");
      expect(init.method ?? "GET").toBe("GET");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(result.notice).toMatch(
        access === "edit" ? /editing link.*original list/ : /view-only link/,
      );
    },
  );

  it.each([undefined, "", "read", "EDIT", "admin"])(
    "rejects unspecified/invalid access %s before HTTP",
    async (access) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(
        client().getSavedListShareLink(12, access as SavedListShareAccess),
      ).rejects.toThrow(/explicitly/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid ID %s before HTTP",
    async (id) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(client().getSavedListShareLink(id, "view")).rejects.toThrow(
        /List ID/,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([null, "", 42])(
    "does not fall back to edit when the view link is missing: %s",
    async (missing) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            response({ ...list, share_url_view_access: missing }),
          ),
      );
      await expect(client().getSavedListShareLink(12, "view")).rejects.toThrow(
        /^No view sharing link is available/,
      );
    },
  );

  it.each([
    "http://oda.com/?pltoken=secret",
    "https://example.com/?pltoken=secret",
    "//example.com/secret",
    "javascript:secret",
    "https://user:secret@oda.com/",
  ])("rejects unsafe URL without exposing it", async (url) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ ...list, share_url_edit_access: url })),
    );
    await expect(client().getSavedListShareLink(12, "edit")).rejects.toThrow(
      /^Invalid or ambiguous sharing link; no link returned$/,
    );
  });

  it("accepts same-origin relative URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({
            ...list,
            share_url_view_access:
              new URL(view).pathname + new URL(view).search,
          }),
        ),
    );
    expect((await client().getSavedListShareLink(12, "view")).url).toBe(view);
  });

  it("fails closed when view and editing links are identical", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ ...list, share_url_view_access: edit })),
    );
    await expect(client().getSavedListShareLink(12, "view")).rejects.toThrow(
      /ambiguous sharing link/,
    );
  });

  it("rejects a response for the wrong list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ...list, id: 13 })),
    );
    await expect(client().getSavedListShareLink(12, "edit")).rejects.toThrow(
      /Unexpected saved list/,
    );
  });

  it.each([401, 403, 500])(
    "does not expose HTTP %s error-body tokens",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({ secret: edit }, status)),
      );
      await expect(client().getSavedListShareLink(12, "view")).rejects.toThrow(
        /^Could not retrieve sharing information\. Check login and list access\.$/,
      );
    },
  );

  it("does not expose transport errors containing tokens", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(edit)));
    await expect(client().getSavedListShareLink(12, "view")).rejects.toThrow(
      /^Could not retrieve sharing information\. Check login and list access\.$/,
    );
  });

  it("does not expose an invalid JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(edit)));
    await expect(client().getSavedListShareLink(12, "view")).rejects.toThrow(
      /^Could not retrieve sharing information\. Check login and list access\.$/,
    );
  });
});
