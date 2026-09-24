/**
 * Core types for MCP Pact: the pact file format (a recorded contract) and
 * the structural "shape" representation used to describe a tool result's
 * JSON structure without pinning down its literal values.
 */

/** The kind of JSON value a shape node describes. */
export type ShapeType =
  | "null"
  | "undefined"
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object";

/**
 * A recursive, structural description of a JSON value: what TYPE each field
 * is, not what VALUE it held when recorded. This is the "contract" that
 * `mcppact verify` re-checks against a live server later.
 */
export interface ShapeNode {
  type: ShapeType;
  /** Present when type === "object": the shape of each observed field. */
  fields?: Record<string, ShapeNode>;
  /**
   * Present when type === "array" and the recorded array was non-empty: the
   * shape of its elements, derived from the array's first element (see
   * README limitations - heterogeneous arrays are not fully modeled).
   */
  items?: ShapeNode;
}

/** A single recorded consumer-driven contract for one MCP `tools/call`. */
export interface Pact {
  pactVersion: 1;
  /** The MCP tool name this pact exercises. */
  tool: string;
  /** The example arguments used to record this pact; replayed verbatim on verify. */
  arguments: Record<string, unknown>;
  /** ISO-8601 timestamp of when the pact was recorded. */
  recordedAt: string;
  /** The shape of the real `tools/call` result captured at record time. */
  resultShape: ShapeNode;
  /** The command line used to launch the server at record time (for reference/documentation only). */
  serverCommand?: string;
}

/** The kind of structural discrepancy found while diffing two shapes. */
export type DiffKind =
  | "missing-field"
  | "extra-field"
  | "type-mismatch"
  | "array-item-mismatch";

/** One structural discrepancy found between a pact's recorded shape and a live result's shape. */
export interface ShapeDiffIssue {
  /** JSON-path-like location of the discrepancy, e.g. `$.structuredContent.email`. */
  path: string;
  kind: DiffKind;
  /** Whether this issue means the contract is BROKEN (vs. purely informational, like an added field). */
  breaking: boolean;
  expectedType?: ShapeType;
  actualType?: ShapeType;
  message: string;
}

/** The result of diffing one pact's recorded shape against a freshly-observed result shape. */
export interface ShapeDiffResult {
  /** True iff there are no breaking issues. */
  ok: boolean;
  issues: ShapeDiffIssue[];
}
