import { describe, expect, test } from "vitest";

import { evaluateConstraint, maskSecretValueForDisplay } from "./secret-validation-rule-fns";
import { ConstraintTarget, ConstraintType } from "./secret-validation-rule-types";

describe("maskSecretValueForDisplay", () => {
  test("fully masks short values", () => {
    expect(maskSecretValueForDisplay("hunter2")).toBe("*******");
    expect(maskSecretValueForDisplay("12345678")).toBe("********");
  });

  test("keeps the edges of longer values visible", () => {
    expect(maskSecretValueForDisplay("pk_live_51Habc9xyz")).toBe("pk_l**********9xyz");
  });

  test("preserves length so the masked value lines up with the reported count", () => {
    const value = "a".repeat(40);
    expect(maskSecretValueForDisplay(value)).toHaveLength(40);
  });
});

describe("evaluateConstraint", () => {
  test("shows the masked value when a value prefix rule fails", () => {
    const message = evaluateConstraint(
      { type: ConstraintType.RequiredPrefix, appliesTo: ConstraintTarget.SecretValue, value: "sk_live_" },
      { key: "STRIPE_KEY", value: "pk_live_51Habc9xyz" }
    );
    expect(message).toBe('value must start with "sk_live_" (got "pk_l**********9xyz")');
  });

  test("shows the key unmasked when a key rule fails", () => {
    const message = evaluateConstraint(
      { type: ConstraintType.RegexPattern, appliesTo: ConstraintTarget.SecretKey, value: "^[A-Z_]+$" },
      { key: "stripe_key", value: "anything" }
    );
    expect(message).toBe('key must match pattern ^[A-Z_]+$ (got "stripe_key")');
  });

  test("includes length and masked value for min length failures", () => {
    const message = evaluateConstraint(
      { type: ConstraintType.MinLength, appliesTo: ConstraintTarget.SecretValue, value: "16" },
      { key: "DB_PASSWORD", value: "short" }
    );
    expect(message).toBe('value must be at least 16 characters (got 5: "*****")');
  });

  test("returns null when the constraint passes", () => {
    const message = evaluateConstraint(
      { type: ConstraintType.RequiredSuffix, appliesTo: ConstraintTarget.SecretValue, value: "==" },
      { key: "TOKEN", value: "abc==" }
    );
    expect(message).toBeNull();
  });

  test("skips value constraints on key-only changes", () => {
    const message = evaluateConstraint(
      { type: ConstraintType.MinLength, appliesTo: ConstraintTarget.SecretValue, value: "16" },
      { key: "DB_PASSWORD" }
    );
    expect(message).toBeNull();
  });
});
