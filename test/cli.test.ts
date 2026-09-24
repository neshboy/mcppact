import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "dist", "cli.js");
const TEST_SERVER_PATH = join(__dirname, "fixtures", "test-server.mjs");

// Quoted so this still parses correctly as a single command when the node
// install path itself contains spaces (common on Windows, e.g. "C:\Program
// Files\nodejs\node.exe") - `--server` is parsed by mcppact's own simple
// shell-style command-line splitter, which honors quoted segments.
const NODE_SERVER_CMD = `"${process.execPath}" "${TEST_SERVER_PATH}"`;
const BROKEN_NODE_SERVER_CMD = `"${process.execPath}" "${TEST_SERVER_PATH}" --break`;

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("mcppact CLI (real subprocess, real built dist/cli.js)", () => {
  it("record writes a pact file, and verify against the same server exits 0", () => {
    const workDir = mkdtempSync(join(tmpdir(), "mcppact-cli-test-"));
    const pactPath = join(workDir, "get_user.json");

    const recordResult = runCli([
      "record",
      "--server",
      NODE_SERVER_CMD,
      "--tool",
      "get_user",
      "--args",
      '{"id": 7}',
      "-o",
      pactPath,
    ]);
    expect(recordResult.status).toBe(0);
    expect(recordResult.stdout).toMatch(/recorded pact/);

    const pact = JSON.parse(readFileSync(pactPath, "utf8"));
    expect(pact.tool).toBe("get_user");
    expect(pact.arguments).toEqual({ id: 7 });

    const verifyResult = runCli(["verify", "--server", NODE_SERVER_CMD, pactPath]);
    expect(verifyResult.status).toBe(0);
    expect(verifyResult.stdout).toMatch(/PASS/);
    expect(verifyResult.stdout).toMatch(/OK - 1\/1 pact\(s\) honored/);
  });

  it("verify against the --break'd server exits non-zero and names the broken fields", () => {
    const workDir = mkdtempSync(join(tmpdir(), "mcppact-cli-test-"));
    const pactPath = join(workDir, "get_user.json");

    const recordResult = runCli([
      "record",
      "--server",
      NODE_SERVER_CMD,
      "--tool",
      "get_user",
      "--args",
      '{"id": 7}',
      "-o",
      pactPath,
    ]);
    expect(recordResult.status).toBe(0);

    const verifyResult = runCli([
      "verify",
      "--server",
      BROKEN_NODE_SERVER_CMD,
      pactPath,
    ]);

    expect(verifyResult.status).toBe(1);
    expect(verifyResult.stdout).toMatch(/FAIL/);
    expect(verifyResult.stdout).toMatch(/structuredContent\.email/);
    expect(verifyResult.stdout).toMatch(/structuredContent\.active/);
    expect(verifyResult.stdout).toMatch(/BROKEN - 0\/1 pact\(s\) honored, 1 broken/);
  });
});
