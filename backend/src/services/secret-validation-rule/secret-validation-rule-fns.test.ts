import { describe, expect, test } from "vitest";

import { enforceSecretValidationRules, maskSecretValueForDisplay } from "./secret-validation-rule-fns";
import { ConstraintTarget, ConstraintType, SecretValidationRuleType } from "./secret-validation-rule-types";

const ENV_ID = "a3f1c2d4-0000-4000-8000-000000000001";

const staticRule = (constraint: { type: ConstraintType; appliesTo: ConstraintTarget; value: string }) => ({
  name: "Stripe keys",
  envId: ENV_ID,
  secretPath: "/",
  type: SecretValidationRuleType.StaticSecrets,
  inputs: { constraints: [constraint] }
});

const enforceAndGetMessage = (
  constraint: { type: ConstraintType; appliesTo: ConstraintTarget; value: string },
  secret: { key: string; value?: string }
) => {
  try {
    enforceSecretValidationRules({
      projectRules: [staticRule(constraint)],
      envId: ENV_ID,
      secretPath: "/",
      secrets: [secret]
    });
  } catch (error) {
    return (error as Error).message;
  }
  return null;
};

describe("maskSecretValueForDisplay", () => {
  test("hides values shorter than 16 characters entirely", () => {
    expect(maskSecretValueForDisplay("hunter2")).toBe("********");
    expect(maskSecretValueForDisplay("fifteen-chars!!")).toBe("********");
  });

  test("shows only the outer three characters of longer values", () => {
    expect(maskSecretValueForDisplay("pk_live_51Habc9xyz")).toBe("pk_****xyz");
  });

  test("does not reveal the length of the value", () => {
    expect(maskSecretValueForDisplay("a".repeat(16))).toHaveLength(maskSecretValueForDisplay("a".repeat(64)).length);
  });
});

describe("enforceSecretValidationRules", () => {
  test("includes the masked value when a value rule fails", () => {
    const message = enforceAndGetMessage(
      { type: ConstraintType.RequiredPrefix, appliesTo: ConstraintTarget.SecretValue, value: "sk_live_" },
      { key: "STRIPE_KEY", value: "pk_live_51Habc9xyz" }
    );
    expect(message).toContain('Secret "STRIPE_KEY": value must start with "sk_live_", got "pk_****xyz"');
  });

  test("includes the key unmasked when a key rule fails", () => {
    const message = enforceAndGetMessage(
      { type: ConstraintType.RegexPattern, appliesTo: ConstraintTarget.SecretKey, value: "^[A-Z_]+$" },
      { key: "stripe_key", value: "anything" }
    );
    expect(message).toContain('key must match pattern ^[A-Z_]+$, got "stripe_key"');
  });

  test("does not throw when every rule passes", () => {
    expect(
      enforceAndGetMessage(
        { type: ConstraintType.RequiredSuffix, appliesTo: ConstraintTarget.SecretValue, value: "==" },
        { key: "TOKEN", value: "abc==" }
      )
    ).toBeNull();
  });
});
