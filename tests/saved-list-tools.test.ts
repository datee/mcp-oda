import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OdaServer } from "../src/server.js";
import { OdaClient } from "../src/oda-client.js";

describe("saved-list MCP tools", () => {
  let client: Client;
  let api: OdaClient;
  let server: McpServer;
  let dir: string;
  let originalListeners: ReturnType<typeof process.listeners>;

  beforeEach(async () => {
    // These protocol tests must never reach Oda or use real session files.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Unexpected network request")),
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oda-tools-"));
    originalListeners = process.listeners("SIGINT");
    const oda = new OdaServer(dir) as unknown as {
      client: OdaClient;
      mcpServer: McpServer;
    };
    api = new OdaClient(path.join(dir, "cookies.json"));
    oda.client = api;
    server = oda.mcpServer;
    client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    for (const listener of process.listeners("SIGINT")) {
      if (!originalListeners.includes(listener))
        process.removeListener("SIGINT", listener);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("advertises write annotations and required confirmation", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(22);
    const create = tools.find((tool) => tool.name === "saved_list_create")!;
    const replace = tools.find(
      (tool) => tool.name === "saved_list_replace_product",
    )!;
    expect(create.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(replace.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(create.inputSchema.required).toContain("confirmation");
    expect(replace.inputSchema.required).toContain("confirmation");
  });

  it("rejects missing confirmation without invoking creation", async () => {
    const create = vi.spyOn(api, "createSavedList");
    const result = await client.callTool({
      name: "saved_list_create",
      arguments: { title: "Test" },
    });
    expect(result.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("asks for the user's access choice without retrieving a link", async () => {
    const share = vi.spyOn(api, "getSavedListShareLink");
    const result = await client.callTool({
      name: "saved_list_get_share_link",
      arguments: { list_id: 12 },
    });
    expect(result.isError).not.toBe(true);
    const content = result.content as { type: string; text: string }[];
    const data = JSON.parse(content[0].text);
    expect(data.status).toBe("needs_access_choice");
    expect(data.question).toContain("edit your original list");
    expect(
      data.choices.map((choice: { access: string }) => choice.access),
    ).toEqual(["view", "edit"]);
    expect(data.url).toBeUndefined();
    expect(share).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["view", "edit"] as const)(
    "passes the explicit %s sharing choice without asking again",
    async (access) => {
      const share = vi.spyOn(api, "getSavedListShareLink").mockResolvedValue({
        list_id: 12,
        title: "Test",
        access,
        url: `https://oda.com/?pltoken=fake-${access}`,
        notice: "Test only",
      });
      const result = await client.callTool({
        name: "saved_list_get_share_link",
        arguments: { list_id: 12, access },
      });
      expect(result.isError).not.toBe(true);
      expect(share).toHaveBeenCalledExactlyOnceWith(12, access);
      expect(JSON.stringify(result.content)).not.toContain(
        "needs_access_choice",
      );
    },
  );

  it("rejects invalid sharing access instead of defaulting", async () => {
    const share = vi.spyOn(api, "getSavedListShareLink");
    const result = await client.callTool({
      name: "saved_list_get_share_link",
      arguments: { list_id: 12, access: "admin" },
    });
    expect(result.isError).toBe(true);
    expect(share).not.toHaveBeenCalled();
  });

  it("advertises a read-only sharing tool with no access default", async () => {
    const { tools } = await client.listTools();
    const share = tools.find(
      (tool) => tool.name === "saved_list_get_share_link",
    )!;
    expect(share.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(share.inputSchema.properties?.access).not.toHaveProperty("default");
    expect(share.description).toContain("Never infer or default");
  });

  it("keeps access links out of tool errors and server logs", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "https://oda.com/?pltoken=secret-link" }),
        { status: 403 },
      ),
    );
    const result = await client.callTool({
      name: "saved_list_get_share_link",
      arguments: { list_id: 12, access: "view" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-link");
    expect(
      fs.readFileSync(path.join(dir, "mcp-oda.log"), "utf8"),
    ).not.toContain("secret-link");
  });

  it("dispatches normalized creation arguments", async () => {
    const create = vi.spyOn(api, "createSavedList").mockResolvedValue({
      id: 12,
      title: "Test",
      description: "",
      number_of_items: 0,
      number_of_products: 0,
      total_quantity: 0,
      url: "https://oda.com/no/account/lists/details/12/",
    });
    const result = await client.callTool({
      name: "saved_list_create",
      arguments: { title: " Test ", confirmation: "CREATE SAVED LIST" },
    });
    expect(result.isError).not.toBe(true);
    expect(create).toHaveBeenCalledWith("Test", undefined);
    expect(JSON.stringify(result.content)).toContain("Test");
  });

  it.each(["uncertain", "verified"] as const)(
    "exposes %s replacement outcomes correctly",
    async (status) => {
      const replace = vi
        .spyOn(api, "replaceProductInSavedList")
        .mockResolvedValue({
          status,
          request_status: "acknowledged",
          list_id: 12,
          old_product_id: 34,
          new_product_id: 56,
          previous_quantity: 2,
          replacement_quantity: 3,
          observed: null,
          message: "Test result",
        });
      const result = await client.callTool({
        name: "saved_list_replace_product",
        arguments: {
          list_id: 12,
          old_product_id: 34,
          new_product_id: 56,
          replacement_quantity: 3,
          confirmation: "UPDATE SAVED LIST",
        },
      });
      expect(replace).toHaveBeenCalledWith(12, 34, 56, 3);
      expect(result.isError).toBe(status === "uncertain");
    },
  );

  it("rejects noninteger quantities and incorrect confirmation without writing", async () => {
    const replace = vi.spyOn(api, "replaceProductInSavedList");
    for (const fields of [
      { replacement_quantity: 1.5, confirmation: "UPDATE SAVED LIST" },
      { confirmation: "YES" },
    ]) {
      const result = await client.callTool({
        name: "saved_list_replace_product",
        arguments: {
          list_id: 12,
          old_product_id: 34,
          new_product_id: 56,
          ...fields,
        },
      });
      expect(result.isError).toBe(true);
    }
    expect(replace).not.toHaveBeenCalled();
  });
});
