import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { asObject, pushFact } from "../shared.js";

export async function collectNetworkExposureEvidence(
  ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  const unknowns: string[] = [];

  if (!ctx.bridgeConfig) {
    unknowns.push("Network exposure could not be summarized because no host-control bridge URL was configured.");
    return { verifiedFacts, unknowns };
  }

  try {
    const bridgeUrl = new URL(ctx.bridgeConfig.bridgeUrl);
    pushFact(verifiedFacts, "bridge.network.protocol", bridgeUrl.protocol.replace(/:$/u, ""));
    pushFact(verifiedFacts, "bridge.network.host", bridgeUrl.hostname);
    pushFact(
      verifiedFacts,
      "bridge.network.port",
      bridgeUrl.port || (bridgeUrl.protocol === "https:" ? "443" : "80"),
    );
  } catch {
    unknowns.push("The configured host-control bridge URL could not be parsed into network coordinates.");
  }

  const components = asObject(ctx.bridgeHealth?.components);
  const integrations = asObject(components?.integrations);
  const gateway = asObject(integrations?.gateway);
  if (gateway && typeof gateway.health === "string" && gateway.health) {
    pushFact(verifiedFacts, "gateway.integration.health", gateway.health);
  }

  unknowns.push(
    "External listener scope, firewall policy, LAN reachability, and Windows portproxy exposure are not proven by the current Telegram runtime evidence alone.",
  );
  return { verifiedFacts, unknowns };
}
