import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { asObject, pushFact } from "../shared.js";

async function checkRuntimeDependencyReachability(
  url: string,
): Promise<{ ok: boolean; modelCount?: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false };
    }
    const json = (await response.json().catch(() => ({}))) as { models?: unknown[] };
    const modelCount = Array.isArray(json.models) ? json.models.length : undefined;
    return { ok: true, modelCount };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectRuntimeDependencyChainEvidence(
  ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  const unknowns: string[] = [];

  const components = asObject(ctx.bridgeHealth?.components);
  const integrations = asObject(components?.integrations);
  if (!integrations) {
    unknowns.push("Runtime dependency facts were not exposed by the current bridge health response.");
    return { verifiedFacts, unknowns };
  }

  const runtime = asObject(integrations.runtime);
  if (runtime) {
    if (typeof runtime.model_provider === "string" && runtime.model_provider) {
      pushFact(verifiedFacts, "runtime.model.provider", runtime.model_provider);
    }
    if (typeof runtime.model === "string" && runtime.model) {
      pushFact(verifiedFacts, "runtime.model.name", runtime.model);
    }
  } else {
    unknowns.push("The bridge response did not include runtime model dependency details.");
  }

  const gateway = asObject(integrations.gateway);
  if (gateway) {
    pushFact(verifiedFacts, "runtime.gateway.ok", String(gateway.ok === true));
  }
  const wsl = asObject(integrations.wsl);
  if (wsl) {
    pushFact(verifiedFacts, "runtime.wsl.ok", String(wsl.ok === true));
  }

  const runtimeDependencyUrl =
    process.env.OPENCLAW_RUNTIME_DEPENDENCY_URL?.trim() ||
    "http://host.docker.internal:11434/api/tags";
  pushFact(verifiedFacts, "runtime.dependency.url", runtimeDependencyUrl);
  const reachability = await checkRuntimeDependencyReachability(runtimeDependencyUrl);
  if (reachability) {
    pushFact(verifiedFacts, "runtime.dependency.reachable", String(reachability.ok));
    if (typeof reachability.modelCount === "number") {
      pushFact(verifiedFacts, "runtime.dependency.modelCount", String(reachability.modelCount));
    }
  } else {
    unknowns.push(`The runtime dependency endpoint ${runtimeDependencyUrl} could not be verified from the current gateway runtime.`);
  }

  return { verifiedFacts, unknowns };
}
