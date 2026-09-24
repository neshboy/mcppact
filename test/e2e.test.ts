import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { recordPact } from "../src/record.js";
import { verifyPacts } from "../src/verify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_SERVER_PATH = join(__dirname, "fixtures", "test-server.mjs");

// `process.execPath` is the real `node` binary running this test; quoting it
// guards against spaces in the install path (common on Windows, e.g.
// "C:\Program Files\nodejs\node.exe").
const NODE = `"${process.execPath}"`;
const GOOD_SERVER = `${NODE} "${TEST_SERVER_PATH}"`;
const BROKEN_SERVER = `${NODE} "${TEST_SERVER_PATH}" --break`;

describe("mcppact record + verify against a real MCP server (real child process, real stdio transport)", () => {
  it("records a real pact from the real server's real result", async () => {
    const pact = await recordPact({ server: GOOD_SERVER, tool: "get_user", arguments: { id: 1 } });

    expect(pact.pactVersion).toBe(1);
    expect(pact.tool).toBe("get_user");
    expect(pact.arguments).toEqual({ id: 1 });
    expect(pact.resultShape.type).toBe("object");

    const structured = pact.resultShape.fields?.structuredContent;
    expect(structured?.type).toBe("object");
    expect(structured?.fields?.id.type).toBe("number");
    expect(structured?.fields?.name.type).toBe("string");
    expect(structured?.fields?.email.type).toBe("string");
    expect(structured?.fields?.active.type).toBe("boolean");
    expect(structured?.fields?.roles).toEqual({ type: "array", items: { type: "string" } });
  });

  it("verifies a recorded pact against the SAME unmodified server: passes", async () => {
    const pact = await recordPact({ server: GOOD_SERVER, tool: "get_user", arguments: { id: 1 } });

    const report = await verifyPacts({
      server: GOOD_SERVER,
      pacts: [{ source: "in-memory-pact", pact }],
    });

    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].ok).toBe(true);
    expect(report.results[0].issues.filter((i) => i.breaking)).toEqual([]);
  });

  it("detects a deliberate breaking change (renamed + dropped fields) when verifying against the MODIFIED server", async () => {
    // Record against the healthy server first, exactly as a consumer would in CI.
    const pact = await recordPact({ server: GOOD_SERVER, tool: "get_user", arguments: { id: 1 } });

    // Now verify against a real client connection to the server started with
    // --break, which really renames "email" -> "contactEmail" and drops "active".
    const report = await verifyPacts({
      server: BROKEN_SERVER,
      pacts: [{ source: "in-memory-pact", pact }],
    });

    expect(report.ok).toBe(false);
    expect(report.results).toHaveLength(1);

    const result = report.results[0];
    expect(result.ok).toBe(false);

    const breaking = result.issues.filter((i) => i.breaking);
    const breakingPaths = breaking.map((i) => i.path).sort();

    // The pact must name the exact fields that broke: the recorded "email"
    // field disappeared, and "active" disappeared too.
    expect(breakingPaths).toEqual(["$.structuredContent.active", "$.structuredContent.email"]);
    expect(breaking.every((i) => i.kind === "missing-field")).toBe(true);

    // The renamed field shows up as a non-breaking "extra field" note, since
    // structurally it's an addition mcppact can't know is a rename.
    const extra = result.issues.find((i) => i.path === "$.structuredContent.contactEmail");
    expect(extra).toBeDefined();
    expect(extra?.breaking).toBe(false);
  });

  it("still verifies unaffected pacts (e.g. `ping`) even when another tool's shape breaks", async () => {
    const pingPact = await recordPact({ server: GOOD_SERVER, tool: "ping", arguments: {} });
    const report = await verifyPacts({ server: BROKEN_SERVER, pacts: [{ source: "ping.json", pact: pingPact }] });
    expect(report.ok).toBe(true);
  });

  it("flags a fully renamed/removed tool as broken, even though the real SDK reports it as an isError result rather than a rejected call", async () => {
    // Verified against the real SDK: calling an unknown tool name does NOT
    // reject client.callTool() - the reference McpServer catches it
    // server-side and returns a normal, successful JSON-RPC response whose
    // *result* has `isError: true`. mcppact must therefore treat any
    // isError result as a break on its own, not rely on a thrown error.
    const pact = await recordPact({ server: GOOD_SERVER, tool: "get_user", arguments: { id: 1 } });
    pact.tool = "get_user_v2_renamed_tool";

    const report = await verifyPacts({ server: GOOD_SERVER, pacts: [{ source: "renamed-tool.json", pact }] });
    expect(report.ok).toBe(false);
    expect(report.results[0].callError).toBeUndefined();

    const breaking = report.results[0].issues.filter((i) => i.breaking);
    expect(breaking.some((i) => i.path === "$" && /returned an error result/.test(i.message))).toBe(true);
  });
});
