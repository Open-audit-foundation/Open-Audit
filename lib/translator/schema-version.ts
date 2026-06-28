import { RegistryTemplateException } from "../errors";

export const BLUEPRINT_SCHEMA_VERSION = "1.0.0";

export interface VersionedBlueprintLike {
  contractName?: string;
  contractId?: string;
  schemaVersion?: string;
}

export function assertBlueprintSchemaVersion(
  blueprint: VersionedBlueprintLike,
  expectedVersion = BLUEPRINT_SCHEMA_VERSION
): void {
  const label = blueprint.contractName ?? blueprint.contractId ?? "unknown blueprint";
  if (!blueprint.schemaVersion) {
    throw new RegistryTemplateException(
      `Blueprint schemaVersion is required for ${label}. Add schemaVersion: "${expectedVersion}" to target the current Open-Audit blueprint schema.`
    );
  }

  if (blueprint.schemaVersion !== expectedVersion) {
    throw new RegistryTemplateException(
      `Blueprint ${label} targets schema v${blueprint.schemaVersion}, runtime expects v${expectedVersion}. Update the blueprint format or run it with a compatible Open-Audit runtime.`
    );
  }
}
