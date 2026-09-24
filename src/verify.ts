/**
 * Real "verify" mode: replays each pact's recorded tool call against a real,
 * currently-running MCP server and structurally diffs the real result's
 * shape against what was recorded, reporting exactly which pacts are
 * honored and which are broken.
 */
import { connectToServer, PACKAGE_NAME, summarizeContentText } from "./client.js";
import { compareShapes, deriveShape } from "./shape.js";
import type { Pact, ShapeDiffIssue } from "./types.js";

export interface NamedPact {
  /** Path (or other human-readable label) identifying where this pact came from. */
  source: string;
  pact: Pact;
}

export interface PactVerificationResult {
  source: string;
  pact: Pact;
  /** True iff the tool call succeeded and its shape matched with no breaking issues. */
  ok: boolean;
  issues: ShapeDiffIssue[];
  /** Set when the tool call itself failed (e.g. tool renamed/removed, transport error). */
  callError?: string;
}

export interface VerifyOptions {
  /** Shell command line that launches the real MCP server to verify against. */
  server: string;
  pacts: NamedPact[];
}

export interface VerifyReport {
  results: PactVerificationResult[];
  /** True iff every pact verified with no breaking issues. */
  ok: boolean;
}

/**
 * Connects once to the real server and replays every pact's recorded tool
 * call against it, in order, structurally diffing each real result's shape
 * against the shape recorded at record time.
 */
export async function verifyPacts(options: VerifyOptions): Promise<VerifyReport> {
  const connection = await connectToServer(options.server, `${PACKAGE_NAME}-verify`);
  const results: PactVerificationResult[] = [];

  try {
    for (const { source, pact } of options.pacts) {
      try {
        const result = await connection.client.callTool({ name: pact.tool, arguments: pact.arguments });
        const actualShape = deriveShape(result);
        const diff = compareShapes(pact.resultShape, actualShape);
        const issues = [...diff.issues];

        // Many real MCP servers (including the reference SDK's high-level
        // McpServer) report failures - unknown tool, bad arguments, a
        // handler throwing - as a normal, successful JSON-RPC response
        // whose *result* has `isError: true`, rather than rejecting the
        // call. The pact was recorded from a successful call, so a live
        // error result is always a break, regardless of whether the
        // error envelope's shape happens to structurally line up.
        if (result.isError) {
          issues.unshift({
            path: "$",
            kind: "type-mismatch",
            breaking: true,
            message: `tool "${pact.tool}" returned an error result on verify (${
              summarizeContentText(result.content) ?? "no error detail provided"
            }), but the pact was recorded from a successful call`,
          });
        }

        const ok = issues.every((issue) => !issue.breaking);
        results.push({ source, pact, ok, issues });
      } catch (err) {
        results.push({
          source,
          pact,
          ok: false,
          issues: [],
          callError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await connection.close();
  }

  return { results, ok: results.every((r) => r.ok) };
}
