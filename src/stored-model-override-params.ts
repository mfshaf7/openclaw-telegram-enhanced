type SessionEntryLike = {
  modelProvider?: unknown;
  model?: unknown;
};

export function buildStoredModelOverrideParams(params: {
  defaultProvider?: string;
  sessionEntry: SessionEntryLike | undefined;
  sessionStore: Record<string, unknown>;
  sessionKey: string;
}) {
  const entryProvider =
    typeof params.sessionEntry?.modelProvider === "string"
      ? params.sessionEntry.modelProvider.trim()
      : "";
  const entryModel =
    typeof params.sessionEntry?.model === "string" ? params.sessionEntry.model.trim() : "";
  const defaultProvider =
    entryProvider || (typeof params.defaultProvider === "string" ? params.defaultProvider.trim() : "");

  return {
    defaultProvider,
    entryProvider,
    entryModel,
    sessionEntry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
  };
}
