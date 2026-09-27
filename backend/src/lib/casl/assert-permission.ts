import { AnyAbility, ForbiddenError, Subject, subject } from "@casl/ability";

/**
 * Thin wrapper over the `ForbiddenError.from(permission).throwUnlessCan(...)` pattern.
 * Pass `conditions` to check a scoped subject; omit it (or pass a pre-built subject as
 * `subjectOrType`) to check a bare subject type. Behaviour is identical to the raw call.
 */
export const assertPermission = (
  permission: AnyAbility,
  action: string,
  subjectOrType: Subject,
  conditions?: Record<string, unknown>
): void => {
  const target = conditions === undefined ? subjectOrType : subject(subjectOrType as string, conditions);
  ForbiddenError.from(permission).throwUnlessCan(action, target);
};
