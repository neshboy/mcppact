import { describe, expect, it } from "vitest";
import { compareShapes, deriveShape } from "../src/shape.js";

describe("deriveShape", () => {
  it("captures primitive types, not values", () => {
    expect(deriveShape("hello")).toEqual({ type: "string" });
    expect(deriveShape(42)).toEqual({ type: "number" });
    expect(deriveShape(true)).toEqual({ type: "boolean" });
    expect(deriveShape(null)).toEqual({ type: "null" });
    expect(deriveShape(undefined)).toEqual({ type: "undefined" });
  });

  it("recursively captures object field types", () => {
    const shape = deriveShape({ id: 1, name: "Ada", active: true, meta: { tags: ["a", "b"] } });
    expect(shape).toEqual({
      type: "object",
      fields: {
        id: { type: "number" },
        name: { type: "string" },
        active: { type: "boolean" },
        meta: {
          type: "object",
          fields: { tags: { type: "array", items: { type: "string" } } },
        },
      },
    });
  });

  it("derives array item shape from the first element", () => {
    expect(deriveShape([1, 2, 3])).toEqual({ type: "array", items: { type: "number" } });
    expect(deriveShape([])).toEqual({ type: "array" });
  });
});

describe("compareShapes", () => {
  it("reports ok with no issues for identical shapes", () => {
    const shape = deriveShape({ id: 1, name: "Ada" });
    const result = compareShapes(shape, deriveShape({ id: 2, name: "Grace" }));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("detects a missing (renamed-away) field as breaking", () => {
    const expected = deriveShape({ id: 1, email: "a@example.com" });
    const actual = deriveShape({ id: 1, contactEmail: "a@example.com" });
    const result = compareShapes(expected, actual);
    expect(result.ok).toBe(false);
    const missing = result.issues.find((i) => i.kind === "missing-field");
    expect(missing).toBeDefined();
    expect(missing?.path).toBe("$.email");
    expect(missing?.breaking).toBe(true);

    const extra = result.issues.find((i) => i.kind === "extra-field");
    expect(extra?.path).toBe("$.contactEmail");
    expect(extra?.breaking).toBe(false);
  });

  it("detects a type change on an existing field as breaking", () => {
    const expected = deriveShape({ active: true });
    const actual = deriveShape({ active: "true" });
    const result = compareShapes(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        path: "$.active",
        kind: "type-mismatch",
        breaking: true,
        expectedType: "boolean",
        actualType: "string",
      }),
    ]);
  });

  it("recurses into nested objects to find the exact broken field", () => {
    const expected = deriveShape({ user: { id: 1, profile: { bio: "hi" } } });
    const actual = deriveShape({ user: { id: 1, profile: {} } });
    const result = compareShapes(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.issues[0].path).toBe("$.user.profile.bio");
  });

  it("recurses into array item shapes", () => {
    const expected = deriveShape({ tags: [{ id: 1, label: "x" }] });
    const actual = deriveShape({ tags: [{ id: 1 }] });
    const result = compareShapes(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.issues[0].path).toBe("$.tags[].label");
  });

  it("does not flag purely additive changes as breaking", () => {
    const expected = deriveShape({ id: 1 });
    const actual = deriveShape({ id: 1, newField: "surprise" });
    const result = compareShapes(expected, actual);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].breaking).toBe(false);
  });

  it("treats an empty live array as non-breaking but notes it could not be verified", () => {
    const expected = deriveShape({ tags: ["a"] });
    const actual = deriveShape({ tags: [] });
    const result = compareShapes(expected, actual);
    expect(result.ok).toBe(true);
    expect(result.issues[0].kind).toBe("array-item-mismatch");
    expect(result.issues[0].breaking).toBe(false);
  });
});
