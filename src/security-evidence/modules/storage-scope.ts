import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { asObject, pushFact } from "../shared.js";

export async function collectStorageScopeEvidence(
  ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  const unknowns: string[] = [];

  const components = asObject(ctx.bridgeHealth?.components);
  const storage = asObject(components?.storage);
  if (!storage) {
    unknowns.push("Storage scope details were not exposed by the current bridge health response.");
    return { verifiedFacts, unknowns };
  }

  if (Array.isArray(storage.allowedRoots)) {
    pushFact(verifiedFacts, "storage.allowedRoots.count", String(storage.allowedRoots.length));
  } else {
    unknowns.push("Allowed roots were not exposed in the bridge storage component.");
  }
  return { verifiedFacts, unknowns };
}
