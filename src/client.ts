/**
 * Real MCP client wiring: spawns an MCP server as a real child process over
 * stdio and connects to it with the real `@modelcontextprotocol/sdk` client.
 * Both `record` and `verify` go through this - there is no mock/fake server
 * path in this module.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const PACKAGE_NAME = "mcppact";
export const PACKAGE_VERSION = "0.1.0";

/**
 * Splits a shell-style command line into a program and its arguments,
 * honoring single- and double-quoted segments (e.g. `--args '{"a": 1}'`).
 * Deliberately simple - not a full shell parser - but enough for the
 * `--server "node server.js --flag"` use case this CLI supports.
 */
export function parseCommandLine(commandLine: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(commandLine)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }
  return parts;
}

export interface ConnectedClient {
  client: Client;
  close(): Promise<void>;
}

/** Spawns `serverCommand` as a real child process and connects a real MCP client to it over stdio. */
export async function connectToServer(serverCommand: string, clientLabel: string): Promise<ConnectedClient> {
  const [command, ...args] = parseCommandLine(serverCommand);
  if (!command) {
    throw new Error(`mcppact: could not parse a command from --server "${serverCommand}"`);
  }

  const transport = new StdioClientTransport({ command, args, stderr: "inherit" });
  const client = new Client({ name: clientLabel, version: PACKAGE_VERSION }, { capabilities: {} });
  await client.connect(transport);

  return {
    client,
    async close() {
      await client.close();
    },
  };
}

/** Best-effort extraction of human-readable text from a `CallToolResult.content` array. */
export function summarizeContentText(content: unknown): string | undefined {
  try {
    if (Array.isArray(content)) {
      const texts = content
        .filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null)
        .map((c) => ("text" in c ? c.text : undefined))
        .filter((t): t is string => typeof t === "string");
      if (texts.length > 0) {
        return texts.join(" ");
      }
    }
  } catch {
    // best-effort only
  }
  return undefined;
}
