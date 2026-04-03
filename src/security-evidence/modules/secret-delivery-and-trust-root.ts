import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { pushFact } from "../shared.js";

function walkConfigSecretShapes(
  value: unknown,
  path: string,
  results: { envBacked: string[]; inlineRisk: string[] },
): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      walkConfigSecretShapes(entry, `${path}[${index}]`, results);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (
      typeof entry === "string" &&
      /(tokenEnv|passwordEnv|secretEnv|vault.*env)$/iu.test(key)
    ) {
      results.envBacked.push(`${nextPath}=${entry}`);
      continue;
    }
    if (
      typeof entry === "string" &&
      /(token|password|secret|apikey|apiKey)$/iu.test(key) &&
      entry.trim()
    ) {
      results.inlineRisk.push(nextPath);
      continue;
    }
    walkConfigSecretShapes(entry, nextPath, results);
  }
}

export async function collectSecretDeliveryAndTrustRootEvidence(
  ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  const unknowns: string[] = [];

  if (ctx.bridgeConfig) {
    pushFact(verifiedFacts, "host-control.bridge.authTokenEnv", ctx.bridgeConfig.authTokenEnv);
  }
  const secretShapes = { envBacked: [] as string[], inlineRisk: [] as string[] };
  walkConfigSecretShapes(ctx.cfg, "", secretShapes);
  if (secretShapes.envBacked.length > 0) {
    pushFact(verifiedFacts, "config.secret.env_refs.count", String(secretShapes.envBacked.length));
    for (const entry of secretShapes.envBacked.slice(0, 8)) {
      pushFact(verifiedFacts, "config.secret.env_ref", entry);
    }
  }
  if (secretShapes.inlineRisk.length > 0) {
    pushFact(verifiedFacts, "config.secret.inline_candidates.count", String(secretShapes.inlineRisk.length));
  }
  if (process.env.VAULT_ADDR?.trim()) {
    pushFact(verifiedFacts, "runtime.vault.addr.present", "true");
  }
  if (process.env.VAULT_TOKEN?.trim()) {
    pushFact(verifiedFacts, "runtime.vault.token.present", "true");
  }
  unknowns.push(
    "Vault, ExternalSecret ownership, Windows trust-root, and rotation posture still require deployment/runtime sources beyond the Telegram config alone.",
  );

  return { verifiedFacts, unknowns };
}
