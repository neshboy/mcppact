/**
 * Real "record" mode: calls a real tool on a real, running MCP server and
 * captures the real result's structural shape as a pact (contract).
 */
import { connectToServer, PACKAGE_NAME, summarizeContentText } from "./client.js";
import { deriveShape } from "./shape.js";
import type { Pact } from "./types.js";

export interface RecordOptions {
  /** Shell command line that launches the real MCP server, e.g. `node real-server.js`. */
  server: string;
  /** The MCP tool name to call and record a contract for. */
  tool: string;
  /** Example arguments to call the tool with; replayed verbatim on verify. */
  arguments: Record<string, unknown>;
}

/**
 * Connects to the real server, calls the real tool with the given example
 * arguments, and returns a {@link Pact} capturing the real result's shape.
 * Throws if the server reports the call as an error result, since there is
 * nothing meaningful to record as a "working" contract in that case.
 */
export async function recordPact(options: RecordOptions): Promise<Pact> {
  const connection = await connectToServer(options.server, `${PACKAGE_NAME}-record`);
  try {
    const result = await connection.client.callTool({ name: options.tool, arguments: options.arguments });

    if (result.isError) {
      const detail = summarizeContentText(result.content);
      throw new Error(
        `mcppact: tool "${options.tool}" returned an error result while recording; refusing to record a pact from an error.${
          detail ? ` Server said: ${detail}` : ""
        }`,
      );
    }

    const resultShape = deriveShape(result);

    return {
      pactVersion: 1,
      tool: options.tool,
      arguments: options.arguments,
      recordedAt: new Date().toISOString(),
      resultShape,
      serverCommand: options.server,
    };
  } finally {
    await connection.close();
  }
}
