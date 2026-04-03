import type { SecurityEvidenceCollectorContext, SecurityEvidenceModuleResult } from "../types.js";
import { asStringArray, pushFact } from "../shared.js";

export async function collectIdentityAndApprovalBoundaryEvidence(
  ctx: SecurityEvidenceCollectorContext,
): Promise<SecurityEvidenceModuleResult> {
  const verifiedFacts: string[] = [];
  const unknowns: string[] = [];

  const telegramCfg =
    ctx.cfg.channels?.telegram && typeof ctx.cfg.channels.telegram === "object"
      ? (ctx.cfg.channels.telegram as Record<string, unknown>)
      : null;
  if (!telegramCfg) {
    unknowns.push("Telegram channel policy was not visible in the current runtime config.");
    return { verifiedFacts, unknowns };
  }

  if (typeof telegramCfg.dmPolicy === "string" && telegramCfg.dmPolicy) {
    pushFact(verifiedFacts, "telegram.dm.policy", telegramCfg.dmPolicy);
  }
  const globalAllowFrom = asStringArray(telegramCfg.allowFrom);
  if (globalAllowFrom.length > 0) {
    pushFact(verifiedFacts, "telegram.dm.allowFrom.count", String(globalAllowFrom.length));
  }
  const globalApprovers = asStringArray(telegramCfg.approvers);
  if (globalApprovers.length > 0) {
    pushFact(verifiedFacts, "telegram.exec.approvers.count", String(globalApprovers.length));
  }

  const groups =
    telegramCfg.groups && typeof telegramCfg.groups === "object" && !Array.isArray(telegramCfg.groups)
      ? (telegramCfg.groups as Record<string, unknown>)
      : {};
  const targetGroup = groups[ctx.chatId];
  if (targetGroup && typeof targetGroup === "object" && !Array.isArray(targetGroup)) {
    const groupConfig = targetGroup as Record<string, unknown>;
    if (typeof groupConfig.groupPolicy === "string" && groupConfig.groupPolicy) {
      pushFact(verifiedFacts, `telegram.group.${ctx.chatId}.policy`, groupConfig.groupPolicy);
    }
    const groupAllowFrom = asStringArray(groupConfig.allowFrom);
    if (groupAllowFrom.length > 0) {
      pushFact(verifiedFacts, `telegram.group.${ctx.chatId}.allowFrom.count`, String(groupAllowFrom.length));
    }
    if (typeof groupConfig.requireMention === "boolean") {
      pushFact(
        verifiedFacts,
        `telegram.group.${ctx.chatId}.requireMention`,
        String(groupConfig.requireMention),
      );
    }
  } else {
    unknowns.push(`No per-group Telegram policy facts were visible for chat ${ctx.chatId}.`);
  }

  if (verifiedFacts.length === 0) {
    unknowns.push("Identity, allowlist, and approval facts were not explicit in the visible Telegram config.");
  }
  return { verifiedFacts, unknowns };
}
