const MARKDOWN_MEDIA_REF_RE = /!?\[[^\]]*]\(([^)\n]+)\)/g;
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const MEDIA_PREFIX_RE = /^MEDIA:\s*/i;

function normalizeLocalMediaTarget(target: string): string | null {
  const normalized = target.trim().replace(/^<(.+)>$/, "$1").replace(MEDIA_PREFIX_RE, "");
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("file://")) {
    return normalized;
  }
  if (normalized.startsWith("/") || WINDOWS_ABSOLUTE_PATH_RE.test(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function extractLocalMarkdownMediaRefs(params: {
  text?: string | null;
  mediaUrls?: ReadonlyArray<string | null | undefined>;
}): { text: string; mediaUrls: string[] } {
  const mediaUrls =
    params.mediaUrls
      ?.map((entry) => (entry?.trim() ? normalizeLocalMediaTarget(entry) ?? entry.trim() : null))
      .filter((entry): entry is string => Boolean(entry)) ?? [];
  const extractedMediaUrls: string[] = [];
  const sourceText = params.text ?? "";
  const rewrittenText = sourceText.replace(MARKDOWN_MEDIA_REF_RE, (match, rawTarget: string) => {
    const target = normalizeLocalMediaTarget(rawTarget);
    if (!target) {
      return match;
    }
    extractedMediaUrls.push(target);
    return "";
  });
  return {
    text: normalizeText(rewrittenText),
    mediaUrls: [...mediaUrls, ...extractedMediaUrls],
  };
}
