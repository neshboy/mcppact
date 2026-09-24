#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";

import { recordPact } from "./record.js";
import { verifyPacts } from "./verify.js";
import type { Pact } from "./types.js";

const PACKAGE_VERSION = "0.1.0";

const program = new Command();

program
  .name("mcppact")
  .description(
    "Consumer-driven contract testing for MCP servers: record the tool calls your integration depends on, then verify a live server still honors their shape.",
  )
  .version(PACKAGE_VERSION);

program
  .command("record")
  .description("Call a real tool on a real MCP server and record its result shape as a pact file.")
  .requiredOption("--server <command>", 'command line that launches the MCP server, e.g. "node server.js"')
  .requiredOption("--tool <name>", "the MCP tool name to call")
  .option("--args <json>", "JSON object of arguments to call the tool with", "{}")
  .requiredOption("-o, --out <path>", "path to write the recorded pact JSON file to")
  .action(async (opts) => {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(opts.args);
    } catch (err) {
      console.error(`mcppact: --args is not valid JSON: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
      return;
    }

    try {
      const pact = await recordPact({ server: opts.server, tool: opts.tool, arguments: args });
      const outPath = resolve(opts.out);
      writeFileSync(outPath, JSON.stringify(pact, null, 2) + "\n", "utf8");
      console.log(`mcppact: recorded pact for tool "${opts.tool}" -> ${outPath}`);
    } catch (err) {
      console.error(`mcppact: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

program
  .command("verify")
  .description("Replay one or more pact files against a real, running MCP server and report any broken contracts.")
  .requiredOption("--server <command>", 'command line that launches the MCP server, e.g. "node server.js"')
  .argument("<pactFiles...>", "one or more pact JSON files to verify")
  .action(async (pactFiles: string[], opts) => {
    const pacts: { source: string; pact: Pact }[] = [];
    for (const file of pactFiles) {
      const path = resolve(file);
      try {
        const raw = readFileSync(path, "utf8");
        const pact = JSON.parse(raw) as Pact;
        if (pact.pactVersion !== 1 || !pact.tool || !pact.resultShape) {
          console.error(`mcppact: ${path} does not look like a valid mcppact pact file.`);
          process.exitCode = 1;
          return;
        }
        pacts.push({ source: file, pact });
      } catch (err) {
        console.error(`mcppact: failed to read pact file ${path}: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
        return;
      }
    }

    if (pacts.length === 0) {
      console.error("mcppact: no pact files given to verify.");
      process.exitCode = 1;
      return;
    }

    try {
      const report = await verifyPacts({ server: opts.server, pacts });
      printReport(report);
      process.exitCode = report.ok ? 0 : 1;
    } catch (err) {
      console.error(`mcppact: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  });

function printReport(report: Awaited<ReturnType<typeof verifyPacts>>): void {
  for (const result of report.results) {
    if (result.ok) {
      console.log(`PASS  ${result.source}  (tool "${result.pact.tool}")`);
      continue;
    }

    console.log(`FAIL  ${result.source}  (tool "${result.pact.tool}")`);
    if (result.callError) {
      console.log(`      call error: ${result.callError}`);
    }
    for (const issue of result.issues.filter((i) => i.breaking)) {
      console.log(`      - [${issue.kind}] ${issue.path}: ${issue.message}`);
    }
    for (const issue of result.issues.filter((i) => !i.breaking)) {
      console.log(`      (info) [${issue.kind}] ${issue.path}: ${issue.message}`);
    }
  }

  const passed = report.results.filter((r) => r.ok).length;
  const total = report.results.length;
  console.log("");
  console.log(
    report.ok
      ? `mcppact: OK - ${passed}/${total} pact(s) honored.`
      : `mcppact: BROKEN - ${passed}/${total} pact(s) honored, ${total - passed} broken.`,
  );
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
