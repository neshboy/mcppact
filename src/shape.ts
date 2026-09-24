/**
 * The heart of MCP Pact's contract model: deriving a structural "shape" from
 * a real JSON value (capturing each field's TYPE, never its literal value),
 * and structurally diffing a recorded shape against a freshly-observed one.
 */
import type { DiffKind, ShapeDiffIssue, ShapeDiffResult, ShapeNode, ShapeType } from "./types.js";

/**
 * Recursively derives a {@link ShapeNode} describing the structure of `value`.
 * Object field types are captured recursively; array shapes are derived from
 * the first element (see README "Limitations" - heterogeneous arrays are not
 * fully modeled by this MVP).
 */
export function deriveShape(value: unknown): ShapeNode {
  if (value === null) {
    return { type: "null" };
  }
  if (value === undefined) {
    return { type: "undefined" };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: "array" };
    }
    return { type: "array", items: deriveShape(value[0]) };
  }
  const t = typeof value;
  if (t === "string") return { type: "string" };
  if (t === "number") return { type: "number" };
  if (t === "boolean") return { type: "boolean" };
  if (t === "object") {
    const fields: Record<string, ShapeNode> = {};
    for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
      fields[key] = deriveShape(fieldValue);
    }
    return { type: "object", fields };
  }
  // functions, symbols, bigint - not valid JSON; treat defensively as "undefined".
  return { type: "undefined" };
}

/**
 * Structurally compares `expected` (the shape recorded in a pact) against
 * `actual` (the shape freshly observed from a live server). Returns every
 * discrepancy found, each flagged as breaking or purely informational.
 *
 * Breaking: a field the consumer depends on is missing, or has changed type.
 * Informational (non-breaking): the live result has an extra field the
 * consumer's pact never mentioned - additive changes are not contract breaks.
 */
export function compareShapes(expected: ShapeNode, actual: ShapeNode, path = "$"): ShapeDiffResult {
  const issues: ShapeDiffIssue[] = [];
  walk(expected, actual, path, issues);
  return { ok: issues.every((issue) => !issue.breaking), issues };
}

function walk(expected: ShapeNode, actual: ShapeNode, path: string, issues: ShapeDiffIssue[]): void {
  if (expected.type !== actual.type) {
    issues.push(
      typeMismatch(path, expected.type, actual.type, `expected type "${expected.type}" but got "${actual.type}"`),
    );
    return;
  }

  if (expected.type === "object") {
    const expectedFields = expected.fields ?? {};
    const actualFields = actual.fields ?? {};
    for (const [key, expectedField] of Object.entries(expectedFields)) {
      const fieldPath = `${path}.${key}`;
      const actualField = actualFields[key];
      if (actualField === undefined) {
        issues.push({
          path: fieldPath,
          kind: "missing-field",
          breaking: true,
          expectedType: expectedField.type,
          message: `expected field "${fieldPath}" (${expectedField.type}) is missing from the live result`,
        });
        continue;
      }
      walk(expectedField, actualField, fieldPath, issues);
    }
    for (const key of Object.keys(actualFields)) {
      if (!(key in expectedFields)) {
        const fieldPath = `${path}.${key}`;
        issues.push({
          path: fieldPath,
          kind: "extra-field",
          breaking: false,
          actualType: actualFields[key].type,
          message: `live result has a field "${fieldPath}" (${actualFields[key].type}) that was not present in the recorded pact (additive change, not a break)`,
        });
      }
    }
    return;
  }

  if (expected.type === "array") {
    if (!expected.items) {
      // Recorded array was empty; nothing further can be asserted about item shape.
      return;
    }
    if (!actual.items) {
      // Live array is empty; cannot confirm item shape, but that's not itself a break.
      issues.push({
        path: `${path}[]`,
        kind: "array-item-mismatch",
        breaking: false,
        message: `recorded array had elements to compare, but the live array at "${path}" is empty; item shape could not be re-verified`,
      });
      return;
    }
    walk(expected.items, actual.items, `${path}[]`, issues);
    return;
  }

  // Primitive types (string/number/boolean/null/undefined) with matching
  // top-level type require no further recursion.
}

function typeMismatch(
  path: string,
  expectedType: ShapeType,
  actualType: ShapeType,
  message: string,
): ShapeDiffIssue {
  return { path, kind: "type-mismatch" as DiffKind, breaking: true, expectedType, actualType, message };
}
