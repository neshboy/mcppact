# MCP Pact

Consumer-driven contract testing for [MCP](https://modelcontextprotocol.io) (Model Context Protocol) servers.

An agent-integration author records the exact tool calls their integration actually depends on
(tool name, example arguments, and the *shape* of the expected result) as a **pact** file. CI then
replays that pact against the real MCP server and checks that the result still matches the recorded
shape - catching breaking changes (renamed tools, changed argument schemas, changed result shapes)
before they silently break every consumer of that server.

```
mcppact record --server "node server.js" --tool get_user --args '{"id": 1}' -o get_user.pact.json
mcppact verify --server "node server.js" get_user.pact.json
```

## Why this exists, and how it differs from its siblings

This is one of three related-but-distinct MCP tools by the same author. They solve different
problems and are not interchangeable:

- **`mcpsqueeze`** is a drop-in *proxy* that sits between an agent and an MCP server and
  deduplicates/truncates large or repeated tool-call results to save context tokens. It's about
  runtime payload size.
- **`mcpseatbelt`** is a policy-enforcing *gateway* that sits between an agent and an MCP server and
  allows/denies/asks-for-confirmation on `tools/call` requests according to a declarative policy.
  It's about runtime authorization.
- **`mcppact`** (this project) does not sit in the runtime path at all. It is a *testing* tool: it
  connects directly to a real MCP server (in CI, in a test suite, from a terminal) to record and
  later verify **contracts** - "does this server's `get_user` tool still return an `email` string
  field the way it did when I wrote my integration against it?" It's about compatibility over time,
  not mediating live traffic.

## How it works

### Record

```
mcppact record --server "<command that launches the server>" --tool <name> --args '<json>' -o pact.json
```

This spawns the given command as a real child process, connects a real `@modelcontextprotocol/sdk`
client to it over stdio, calls `<name>` with the given arguments via a real `tools/call` request, and
writes a pact file containing:

- the tool name and the exact arguments used,
- a recursively-derived **shape** of the real result - each field's *type* (`string`, `number`,
  `boolean`, `array`, `object`, `null`) - not its literal value, since values legitimately vary
  between calls (a fresh `id`, a different timestamp, etc). The shape is the contract.

Example pact, produced by actually running `mcppact record` against the test fixture server in this
repo (`examples/get_user.pact.json`):

```json
{
  "pactVersion": 1,
  "tool": "get_user",
  "arguments": { "id": 1 },
  "recordedAt": "2026-09-24T09:48:09.229Z",
  "resultShape": {
    "type": "object",
    "fields": {
      "content": {
        "type": "array",
        "items": {
          "type": "object",
          "fields": { "type": { "type": "string" }, "text": { "type": "string" } }
        }
      },
      "structuredContent": {
        "type": "object",
        "fields": {
          "id": { "type": "number" },
          "name": { "type": "string" },
          "email": { "type": "string" },
          "active": { "type": "boolean" },
          "roles": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  },
  "serverCommand": "node test/fixtures/test-server.mjs"
}
```

### Verify

```
mcppact verify --server "<command that launches the server>" pact1.json [pact2.json ...]
```

This spawns (or connects to) the currently-running real server, replays each pact's recorded
`tools/call` exactly as recorded, and structurally diffs the real result's shape against the
recorded shape:

- a field the pact depends on that's now **missing** -> breaking
- a field whose **type changed** (e.g. `string` -> `number`) -> breaking
- a field the live result has that the pact never mentioned -> reported, but **not** breaking
  (additive changes don't break existing consumers)
- the tool call itself failing, or the server returning an error result where the pact recorded a
  success -> breaking

Exit code is non-zero if any pact is broken, so `mcppact verify` is a normal CI gate.

```
$ mcppact verify --server "node server.js --break" get_user.pact.json
FAIL  get_user.pact.json  (tool "get_user")
      - [missing-field] $.structuredContent.email: expected field "$.structuredContent.email" (string) is missing from the live result
      - [missing-field] $.structuredContent.active: expected field "$.structuredContent.active" (boolean) is missing from the live result
      (info) [extra-field] $.structuredContent.contactEmail: live result has a field "$.structuredContent.contactEmail" (string) that was not present in the recorded pact (additive change, not a break)

mcppact: BROKEN - 0/1 pact(s) honored, 1 broken.
```

## Install / quick start

```bash
git clone <this repo>
cd mcppact
npm install
npm run build

# Record a contract against a real server you control:
node dist/cli.js record --server "node path/to/your-server.js" --tool your_tool --args '{"foo": "bar"}' -o pacts/your_tool.pact.json

# Later (e.g. in CI, after the server has been upgraded/redeployed), verify it still holds:
node dist/cli.js verify --server "node path/to/your-server.js" pacts/*.json
```

Or, once published: `npm install -g mcppact` and drop the `node dist/cli.js` prefix for `mcppact`.

`--server` is parsed as a simple shell-style command line (it honors `"..."`/`'...'` quoting for
arguments with spaces, e.g. `--server "node server.js --config 'my config.json'"`), then spawned
directly with `child_process` - no actual shell is invoked.

## Development

```bash
npm install
npm run build      # compile TypeScript -> dist/
npm test           # builds, then runs the real vitest suite (spawns real child-process MCP servers)
npm run typecheck
```

The test suite spawns the real fixture MCP server at `test/fixtures/test-server.mjs`, records a real
pact against it, verifies that pact against the same unmodified server (passes), then verifies the
same pact against the same server started with `--break` (which really renames its `email` field to
`contactEmail` and drops `active`) and asserts the break is detected and reported by exact field path.

## Limitations

This is a focused MVP. Known, deliberate scope cuts:

- **Shape-only contracts, not value-level assertions.** A pact never records or checks literal
  values (`"the user's name must be exactly 'Ada'"`), only structural type. If a server changes a
  string field to a number, that's caught; if it changes the *content* of a string in a way your
  integration depends on, it is not.
- **Arrays are shaped from their first element only.** A recorded array's item shape comes from
  `array[0]`; heterogeneous arrays (elements with genuinely different shapes) are not fully modeled.
- **Only `tools/call` is supported.** There is no support yet for recording/verifying
  `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, or other MCP methods.
- **No schema-level checks.** `mcppact` does not inspect or diff a server's declared JSON Schema for
  a tool's input/output - it only checks the shape of what the tool actually returned at record
  time versus what it actually returns at verify time.
- **Single server target per verify run.** `verify` connects to one server command and replays every
  given pact against it; there's no multi-server matrix or parallelism yet.
- **No hosted broker.** Pact files are plain JSON on disk; there's no pact-broker-style central
  registry (yet) - check them into your repo alongside the consumer that depends on them.

## License

MIT (c) 2026 MCP Pact contributors. See [LICENSE](./LICENSE).
