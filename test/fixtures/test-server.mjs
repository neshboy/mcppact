#!/usr/bin/env node
// A small, real MCP server used as a test fixture for MCP Pact. It actually
// speaks MCP over stdio via the real SDK. Its `get_user` tool normally
// returns a user record with an "email" field; when started with the
// `--break` flag it renames that field to "contactEmail" and drops the
// "active" field, simulating a real breaking change to the server's result
// shape between a pact's record time and a later verify run.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const broken = process.argv.includes("--break");

const server = new McpServer({ name: "mcppact-test-server", version: "0.1.0" });

server.registerTool(
  "get_user",
  {
    description: "Look up a user by id.",
    inputSchema: { id: z.number() },
  },
  async ({ id }) => {
    const user = broken
      ? {
          id,
          name: "Ada Lovelace",
          contactEmail: "ada@example.com", // renamed from "email"
          roles: ["admin", "editor"],
          // "active" field removed entirely
        }
      : {
          id,
          name: "Ada Lovelace",
          email: "ada@example.com",
          active: true,
          roles: ["admin", "editor"],
        };

    return {
      content: [{ type: "text", text: JSON.stringify(user) }],
      structuredContent: user,
    };
  },
);

server.registerTool(
  "ping",
  {
    description: "Always returns a trivial success result; used to sanity-check connectivity.",
    inputSchema: {},
  },
  async () => {
    return { content: [{ type: "text", text: "pong" }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
