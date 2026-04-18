export const IDEA_COMMAND = {
  command: "idea",
  description: "Create or inspect idea records in the Workspace Proposals backlog",
} as const;

const BASE_URL_ENV = "OPERATOR_ORCHESTRATION_BASE_URL";
const CALLER_ID_ENV = "OPERATOR_ORCHESTRATION_CALLER_ID";
const CALLER_SECRET_ENV = "OPERATOR_ORCHESTRATION_CALLER_SECRET";
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 25;

type IdeaCommandReply = {
  text: string;
  isError?: boolean;
};

type IdeaWorkflowDescriptor = {
  lifecycle_note?: string;
  lifecycle_statuses?: Array<{
    meaning?: string;
    next_step?: string;
    status?: string;
  }>;
  title?: string;
  purpose?: string;
  operator_guidance?: {
    what_to_send?: string[];
    examples?: string[];
    after_capture?: string[];
  };
  source_hints?: {
    telegram?: {
      command_descriptors?: Array<{
        invocation?: string;
        purpose?: string;
      }>;
      help_invocation?: string;
      invocation_examples?: string[];
      note?: string;
    };
  };
};

type IdeaRecordProjection = {
  body?: string | null;
  created_at?: string | null;
  idea_id?: string;
  record_ref?: string;
  source?: {
    surface?: string;
    integration_id?: string;
  };
  status?: string;
  title?: string;
  updated_at?: string | null;
};

type IdeaListResponse = {
  ideas?: Array<{
    body_preview?: string | null;
    idea_id?: string;
    record_ref?: string;
    status?: string;
    title?: string;
    updated_at?: string | null;
  }>;
  page?: {
    count?: number;
    has_more?: boolean;
    limit?: number;
    next_offset?: number | null;
    offset?: number;
    total?: number;
  };
};

type IdeaCommandParams = {
  accountId: string;
  chatType: string;
  messageId: number;
  rawArgs: string | undefined;
  senderId: string;
  senderUsername: string;
  telegramChatId: number;
  telegramThreadId?: number;
};

type IdeaCommandAction =
  | { kind: "help" }
  | { kind: "capture"; rawText: string }
  | { kind: "list"; limit: number; offset: number }
  | { kind: "listAll" }
  | { kind: "show"; ideaId: string };

function trimEnv(name: string, env = process.env): string {
  return env[name]?.trim() ?? "";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildIdeaTitle(rawText: string): string {
  const normalized = rawText
    .split(/\r?\n/, 1)[0]
    ?.replace(/\s+/g, " ")
    .trim();
  return truncate(normalized || "Captured Telegram idea", 96);
}

function isIdeaHelpRequest(rawText: string): boolean {
  const normalized = rawText.trim().toLowerCase();
  return normalized === "help" || normalized === "--help" || normalized === "-h" ||
    normalized === "usage" || normalized === "?";
}

function parsePositiveInteger(rawValue: string | undefined): number | null {
  if (!rawValue?.trim()) {
    return null;
  }

  const parsed = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseIdeaCommand(rawArgs: string | undefined): IdeaCommandAction | IdeaCommandReply {
  const rawText = rawArgs?.trim() ?? "";
  if (!rawText || isIdeaHelpRequest(rawText)) {
    return { kind: "help" };
  }

  const parts = rawText.split(/\s+/).filter(Boolean);
  const subcommand = parts[0]?.toLowerCase() ?? "";

  if (subcommand === "all") {
    if (parts.length > 1) {
      return {
        isError: true,
        text: "Usage: /idea list all",
      };
    }

    return {
      kind: "listAll",
    };
  }

  if (subcommand === "list" || subcommand === "ls") {
    if (parts[1]?.toLowerCase() === "all") {
      if (parts.length > 2) {
        return {
          isError: true,
          text: "Usage: /idea list all",
        };
      }

      return {
        kind: "listAll",
      };
    }

    if (parts.length > 3) {
      return {
        isError: true,
        text: "Usage: /idea list [limit] [offset]",
      };
    }

    const limit = parts[1] ? parsePositiveInteger(parts[1]) : DEFAULT_LIST_LIMIT;
    const offset = parts[2] ? parsePositiveInteger(parts[2]) : 1;

    if (!limit || !offset || limit > MAX_LIST_LIMIT) {
      return {
        isError: true,
        text: `Usage: /idea list [limit] [offset]\nLimit must be between 1 and ${MAX_LIST_LIMIT}.`,
      };
    }

    return {
      kind: "list",
      limit,
      offset,
    };
  }

  if (subcommand === "show" || subcommand === "get" || subcommand === "status") {
    const ideaId = parts[1]?.trim() ?? "";
    if (!/^idea-\d+$/i.test(ideaId)) {
      return {
        isError: true,
        text: "Usage: /idea show <idea-id>",
      };
    }

    return {
      kind: "show",
      ideaId: ideaId.toLowerCase(),
    };
  }

  return {
    kind: "capture",
    rawText,
  };
}

export function isIdeaCaptureConfigured(env = process.env): boolean {
  return Boolean(
    trimEnv(BASE_URL_ENV, env) &&
      trimEnv(CALLER_ID_ENV, env) &&
      trimEnv(CALLER_SECRET_ENV, env),
  );
}

function loadIdeaCaptureConfig(env = process.env) {
  const baseUrl = trimEnv(BASE_URL_ENV, env).replace(/\/$/, "");
  const callerId = trimEnv(CALLER_ID_ENV, env);
  const callerSecret = trimEnv(CALLER_SECRET_ENV, env);

  if (!baseUrl || !callerId || !callerSecret) {
    return null;
  }

  return {
    baseUrl,
    callerId,
    callerSecret,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildBrokerHeaders(config: NonNullable<ReturnType<typeof loadIdeaCaptureConfig>>) {
  return {
    "Content-Type": "application/json",
    "x-oos-caller-id": config.callerId,
    "x-oos-caller-secret": config.callerSecret,
  };
}

async function performBrokerRequest(
  config: NonNullable<ReturnType<typeof loadIdeaCaptureConfig>>,
  input: {
    body?: string;
    errorPrefix: string;
    fallbackMessage: string;
    method: "GET" | "POST";
    path: string;
  },
): Promise<IdeaCommandReply | Record<string, unknown>> {
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}${input.path}`, {
      method: input.method,
      headers: buildBrokerHeaders(config),
      ...(input.body ? { body: input.body } : {}),
    });
  } catch (error) {
    return {
      isError: true,
      text: `${input.errorPrefix} before reaching the broker: ${String(error)}`,
    };
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const errorCode =
      typeof payload.error === "string" && payload.error ? payload.error : `http_${response.status}`;
    const message =
      typeof payload.message === "string" && payload.message
        ? payload.message
        : input.fallbackMessage;
    return {
      isError: true,
      text: `${input.errorPrefix} (${errorCode}): ${message}`,
    };
  }

  return payload;
}

async function fetchIdeaWorkflowDescriptor(
  config: NonNullable<ReturnType<typeof loadIdeaCaptureConfig>>,
): Promise<IdeaCommandReply | IdeaWorkflowDescriptor> {
  return await performBrokerRequest(config, {
    errorPrefix: "Idea workflow guidance failed",
    fallbackMessage: "Broker rejected the workflow guidance request.",
    method: "GET",
    path: "/v1/workflows/idea-command",
  }) as Promise<IdeaCommandReply | IdeaWorkflowDescriptor>;
}

function renderIdeaWorkflowGuidance(descriptor: IdeaWorkflowDescriptor): string {
  const lines = [
    descriptor.title?.trim() || "Idea workflow",
  ];

  if (descriptor.purpose?.trim()) {
    lines.push("", descriptor.purpose.trim());
  }

  const telegramHints = descriptor.source_hints?.telegram;
  const invocationExamples = telegramHints?.invocation_examples?.filter(Boolean) ?? [];
  const commandDescriptors = telegramHints?.command_descriptors?.filter(
    (entry) => entry?.invocation?.trim() && entry?.purpose?.trim(),
  ) ?? [];
  if (commandDescriptors.length > 0) {
    lines.push(
      "",
      "Current command surface:",
      renderCodeTable(
        ["Command", "Purpose"],
        commandDescriptors.map((entry) => [
          entry.invocation?.trim() ?? "",
          entry.purpose?.trim() ?? "",
        ]),
        [24, 72],
      ),
    );
    const coveredInvocations = new Set(
      commandDescriptors.map((entry) => entry.invocation?.trim()).filter(Boolean),
    );
    const additionalInvocations = invocationExamples.filter((example) => !coveredInvocations.has(example));
    if (additionalInvocations.length > 0) {
      lines.push("", "Additional invocations:");
      for (const example of additionalInvocations) {
        lines.push(example);
      }
    }
  } else {
    if (invocationExamples.length > 0) {
      lines.push("", "Usage:");
      for (const example of invocationExamples) {
        lines.push(example);
      }
    }
  }

  if (telegramHints?.note?.trim()) {
    lines.push("", telegramHints.note.trim());
  }

  const lifecycleStatuses = descriptor.lifecycle_statuses?.filter(
    (entry) => entry?.status?.trim() && entry?.meaning?.trim(),
  ) ?? [];
  if (lifecycleStatuses.length > 0) {
    lines.push(
      "",
      "Status lifecycle:",
      renderCodeTable(
        ["Status", "Meaning", "How it moves forward"],
        lifecycleStatuses.map((entry) => [
          entry.status?.trim() ?? "",
          entry.meaning?.trim() ?? "",
          entry.next_step?.trim() ?? "",
        ]),
        [14, 40, 54],
      ),
    );
  }

  if (descriptor.lifecycle_note?.trim()) {
    lines.push("", descriptor.lifecycle_note.trim());
  }

  const whatToSend = descriptor.operator_guidance?.what_to_send?.filter(Boolean) ?? [];
  if (whatToSend.length > 0) {
    lines.push("", "Available actions:");
    for (const item of whatToSend) {
      lines.push(`- ${item}`);
    }
  }

  const examples = descriptor.operator_guidance?.examples?.filter(Boolean) ?? [];
  if (examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of examples) {
      lines.push(`- ${example}`);
    }
  }

  const afterCapture = descriptor.operator_guidance?.after_capture?.filter(Boolean) ?? [];
  if (afterCapture.length > 0) {
    lines.push("", "What you will see back:");
    for (const item of afterCapture) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}

function sanitizeTableCell(value: string): string {
  return value.replace(/\s+/g, " ").replace(/`/g, "'").trim();
}

function compactTimestamp(rawValue: string): string {
  const trimmed = rawValue.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?Z$/);
  if (match) {
    return `${match[1]} ${match[2]}Z`;
  }

  return sanitizeTableCell(trimmed);
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function renderCodeTable(
  headers: string[],
  rows: string[][],
  maxWidths: number[],
): string {
  const normalizedRows = rows.map((row) =>
    row.map((value, index) =>
      truncate(sanitizeTableCell(value ?? ""), maxWidths[index] ?? 48),
    ));
  const widths = headers.map((header, index) => {
    const rowWidth = Math.max(
      0,
      ...normalizedRows.map((row) => row[index]?.length ?? 0),
    );
    return Math.max(header.length, Math.min(maxWidths[index] ?? 48, rowWidth));
  });

  const formatRow = (row: string[]) =>
    row
      .map((value, index) => padCell(value ?? "", widths[index] ?? 1))
      .join(" | ");

  return [
    "```text",
    formatRow(headers),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...normalizedRows.map((row) => formatRow(row)),
    "```",
  ].join("\n");
}

function formatIdeaRecord(record: IdeaRecordProjection): string {
  const ideaId = record.idea_id?.trim() || "unknown";
  const status = record.status?.trim() || "unknown";
  const recordRef = record.record_ref?.trim() || "record-ref-unavailable";
  const title = record.title?.trim() || "Untitled idea";
  const body = record.body?.trim() || "_No body stored._";
  const updatedAt = compactTimestamp(record.updated_at?.trim() || record.created_at?.trim() || "unknown");
  const sourceSurface = record.source?.surface?.trim() || "unknown";
  const integrationId = record.source?.integration_id?.trim() || "default";

  return [
    "Idea record:",
    renderCodeTable(
      ["Field", "Value"],
      [
        ["Idea ID", ideaId],
        ["Status", status],
        ["Record", recordRef],
        ["Updated", updatedAt],
        ["Source", `${sourceSurface}/${integrationId}`],
      ],
      [14, 86],
    ),
    "",
    `Title: ${title}`,
    "",
    "Body:",
    body,
    "",
    `Review the backlog: /idea list`,
  ].join("\n");
}

function formatIdeaList(
  ideas: IdeaListResponse["ideas"],
  options: {
    mode: "recent" | "all";
    nextOffset?: number | null;
    offset: number;
    requestedLimit: number;
    total: number;
  },
): string {
  const normalizedIdeas = Array.isArray(ideas) ? ideas : [];

  if (normalizedIdeas.length === 0) {
    return "No submitted ideas found.";
  }

  const count = normalizedIdeas.length;
  const lines = [
    options.mode === "all"
      ? `Stored ideas: showing all ${options.total}`
      : `Stored ideas: showing ${options.offset}-${options.offset + count - 1} of ${options.total}`,
    renderCodeTable(
      ["Idea ID", "Status", "Updated", "Title"],
      normalizedIdeas.map((idea) => [
        idea.idea_id?.trim() || "unknown",
        idea.status?.trim() || "unknown",
        compactTimestamp(idea.updated_at?.trim() || "unknown"),
        idea.title?.trim() || "Untitled idea",
      ]),
      [10, 14, 17, 52],
    ),
  ];

  lines.push("", "Details: /idea show <idea-id>");

  if (options.mode === "recent" && typeof options.nextOffset === "number") {
    lines.push(`More: /idea list ${options.requestedLimit} ${options.nextOffset}`);
    lines.push("Everything: /idea list all");
  }

  return lines.join("\n");
}

async function listIdeasThroughBroker(
  config: NonNullable<ReturnType<typeof loadIdeaCaptureConfig>>,
  action: Extract<IdeaCommandAction, { kind: "list" }>,
): Promise<IdeaCommandReply> {
  const payload = await performBrokerRequest(config, {
    errorPrefix: "Idea list failed",
    fallbackMessage: "Broker rejected the idea list request.",
    method: "GET",
    path: `/v1/ideas?limit=${action.limit}&offset=${action.offset}`,
  });

  if ("text" in payload) {
    return payload;
  }

  return {
    text: formatIdeaList((payload as IdeaListResponse).ideas, {
      mode: "recent",
      nextOffset:
        typeof (payload as IdeaListResponse).page?.next_offset === "number"
          ? (payload as IdeaListResponse).page?.next_offset ?? null
          : null,
      offset:
        typeof (payload as IdeaListResponse).page?.offset === "number"
          ? (payload as IdeaListResponse).page?.offset ?? 1
          : 1,
      requestedLimit: action.limit,
      total:
        typeof (payload as IdeaListResponse).page?.total === "number"
          ? (payload as IdeaListResponse).page?.total ?? 0
          : Array.isArray((payload as IdeaListResponse).ideas)
            ? (payload as IdeaListResponse).ideas?.length ?? 0
            : 0,
    }),
  };
}

async function listAllIdeasThroughBroker(
  config: NonNullable<ReturnType<typeof loadIdeaCaptureConfig>>,
): Promise<IdeaCommandReply> {
  const collected: NonNullable<IdeaListResponse["ideas"]> = [];
  let offset = 1;
  let total = 0;
  const seenOffsets = new Set<number>();

  while (true) {
    if (seenOffsets.has(offset)) {
      return {
        isError: true,
        text: "Idea list all failed: broker pagination did not advance cleanly.",
      };
    }
    seenOffsets.add(offset);

    const payload = await performBrokerRequest(config, {
      errorPrefix: "Idea list failed",
      fallbackMessage: "Broker rejected the idea list request.",
      method: "GET",
      path: `/v1/ideas?limit=${MAX_LIST_LIMIT}&offset=${offset}`,
    });

    if ("text" in payload) {
      return payload;
    }

    const response = payload as IdeaListResponse;
    const page = response.page ?? {};
    const pageIdeas = Array.isArray(response.ideas) ? response.ideas : [];
    collected.push(...pageIdeas);
    total = typeof page.total === "number" ? page.total : collected.length;

    if (page.has_more !== true || typeof page.next_offset !== "number") {
      break;
    }

    offset = page.next_offset;
  }

  return {
    text: formatIdeaList(collected, {
      mode: "all",
      offset: 1,
      requestedLimit: MAX_LIST_LIMIT,
      total: total || collected.length,
    }),
  };
}

async function showIdeaThroughBroker(
  config: NonNullable<ReturnType<typeof loadIdeaCaptureConfig>>,
  action: Extract<IdeaCommandAction, { kind: "show" }>,
): Promise<IdeaCommandReply> {
  const payload = await performBrokerRequest(config, {
    errorPrefix: "Idea read failed",
    fallbackMessage: "Broker rejected the idea read request.",
    method: "GET",
    path: `/v1/ideas/${action.ideaId}`,
  });

  if ("text" in payload) {
    return payload;
  }

  return {
    text: formatIdeaRecord(payload as IdeaRecordProjection),
  };
}

async function captureIdeaRequest(
  config: NonNullable<ReturnType<typeof loadIdeaCaptureConfig>>,
  params: IdeaCommandParams,
  rawText: string,
): Promise<IdeaCommandReply> {
  const payload = await performBrokerRequest(config, {
    body: JSON.stringify({
      operator: {
        id: params.senderId,
        handle: params.senderUsername,
      },
      source: {
        surface: "telegram",
        integration_id: params.accountId,
        context_ref: {
          conversation_id: String(params.telegramChatId),
          conversation_type: params.chatType,
          ...(params.telegramThreadId !== undefined
            ? {
                thread_id: String(params.telegramThreadId),
              }
            : {}),
        },
        native_ref: {
          command: "idea",
          message_id: String(params.messageId),
        },
      },
      title: buildIdeaTitle(rawText),
      body: rawText,
    }),
    errorPrefix: "Idea capture failed",
    fallbackMessage: "Broker rejected the idea capture request.",
    method: "POST",
    path: "/v1/ideas/capture",
  });

  if ("text" in payload) {
    return payload;
  }

  const ideaId = typeof payload.idea_id === "string" ? payload.idea_id : "unknown";
  const recordRef =
    typeof payload.record_ref === "string" ? payload.record_ref : "record-ref-unavailable";
  const status = typeof payload.status === "string" ? payload.status : "captured";

  return {
    text: `Captured ${ideaId} [${status}]\nRecord: ${recordRef}\nReview: /idea show ${ideaId}`,
  };
}

export async function captureIdeaThroughBroker(
  params: IdeaCommandParams,
): Promise<IdeaCommandReply> {
  const config = loadIdeaCaptureConfig();

  if (!config) {
    return {
      isError: true,
      text:
        "Idea workflow is not configured in this runtime. Check OPERATOR_ORCHESTRATION_BASE_URL, OPERATOR_ORCHESTRATION_CALLER_ID, and OPERATOR_ORCHESTRATION_CALLER_SECRET in the gateway environment.",
    };
  }

  const action = parseIdeaCommand(params.rawArgs);
  if ("text" in action) {
    return action;
  }

  if (action.kind === "help") {
    const descriptor = await fetchIdeaWorkflowDescriptor(config);
    if ("text" in descriptor) {
      return descriptor;
    }

    return {
      text: renderIdeaWorkflowGuidance(descriptor),
    };
  }

  if (action.kind === "list") {
    return await listIdeasThroughBroker(config, action);
  }

  if (action.kind === "listAll") {
    return await listAllIdeasThroughBroker(config);
  }

  if (action.kind === "show") {
    return await showIdeaThroughBroker(config, action);
  }

  return await captureIdeaRequest(config, params, action.rawText);
}
