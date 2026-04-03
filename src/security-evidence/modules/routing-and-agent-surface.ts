import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { pushFact } from "../shared.js";

const SECURITY_ARCHITECTURE_AGENT_ID = "security-architecture";
const SECURITY_EVIDENCE_AGENT_ID = "security-evidence";

export async function collectRoutingAndAgentSurfaceEvidence(
  ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  const inferences: string[] = [];
  const unknowns: string[] = [];

  const telegramCfg = ctx.cfg.channels?.telegram;
  const groupCfg =
    telegramCfg && typeof telegramCfg === "object" && !Array.isArray(telegramCfg)
      ? (telegramCfg as { groups?: Record<string, unknown> }).groups
      : undefined;
  const targetGroup =
    groupCfg && typeof groupCfg === "object" && !Array.isArray(groupCfg)
      ? groupCfg[ctx.chatId]
      : undefined;
  if (targetGroup && typeof targetGroup === "object" && !Array.isArray(targetGroup)) {
    const topics = (targetGroup as { topics?: Record<string, unknown> }).topics;
    if (topics && typeof topics === "object" && !Array.isArray(topics)) {
      for (const [topicId, topicValue] of Object.entries(topics)) {
        if (!topicValue || typeof topicValue !== "object" || Array.isArray(topicValue)) {
          continue;
        }
        const topic = topicValue as { agentId?: unknown; enabled?: unknown };
        if (topic.enabled === false || typeof topic.agentId !== "string" || !topic.agentId) {
          continue;
        }
        pushFact(verifiedFacts, `telegram.topic.${topicId}.agent`, topic.agentId);
      }
    }
  }

  const agentList = ctx.cfg.agents?.list ?? [];
  for (const agent of agentList) {
    if (!agent?.id) {
      continue;
    }
    if (agent.id === SECURITY_EVIDENCE_AGENT_ID) {
      const allow = Array.isArray(agent.tools?.allow) ? agent.tools.allow.join(", ") : "";
      const deny = Array.isArray(agent.tools?.deny) ? agent.tools.deny.join(", ") : "";
      if (allow) {
        pushFact(verifiedFacts, `${SECURITY_EVIDENCE_AGENT_ID}.tools.allow`, allow);
      }
      if (deny) {
        pushFact(verifiedFacts, `${SECURITY_EVIDENCE_AGENT_ID}.tools.deny`, deny);
      }
    }
    if (agent.id === SECURITY_ARCHITECTURE_AGENT_ID) {
      const deny = Array.isArray(agent.tools?.deny) ? agent.tools.deny.join(", ") : "none";
      pushFact(verifiedFacts, `${SECURITY_ARCHITECTURE_AGENT_ID}.tools.deny`, deny);
    }
  }

  pushFact(
    inferences,
    "routing.separation",
    "architecture judgment and deterministic evidence are separated by topic",
  );
  if (verifiedFacts.length === 0) {
    unknowns.push("Telegram topic bindings and agent tool surface were not visible in the current runtime config.");
  }

  return { verifiedFacts, inferences, unknowns };
}
