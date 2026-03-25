const MARKDOWN_MEDIA_REF_RE = /!?\[[^\]]*]\(([^)\n]+)\)/g;
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;

function isLocalMediaTarget(target: string): boolean {
  const normalized = target.trim().replace(/^<(.+)>$/, "$1");
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("file://")) {
    return true;
  }
  if (normalized.startsWith("/") || WINDOWS_ABSOLUTE_PATH_RE.test(normalized)) {
    return true;
  }
  return false;
}

function normalizeText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function extractLocalMarkdownMediaRefs(params: {
  text?: string | null;
  mediaUrls?: ReadonlyArray<string | null | undefined>;
}): { text: string; mediaUrls: string[] } {
  const mediaUrls = params.mediaUrls?.filter((entry): entry is string => Boolean(entry?.trim())) ?? [];
  const extractedMediaUrls: string[] = [];
  const sourceText = params.text ?? "";
  const rewrittenText = sourceText.replace(MARKDOWN_MEDIA_REF_RE, (match, rawTarget: string) => {
    const target = rawTarget.trim().replace(/^<(.+)>$/, "$1");
    if (!isLocalMediaTarget(target)) {
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
