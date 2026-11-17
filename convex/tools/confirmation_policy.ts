// Pure policy for tool calls that need an explicit user confirmation before
// they run. The registry gate (`confirmation_gate.ts`) applies it; Convex
// mutations in `convex/tool_confirmations/` own the durable request state.

export type ToolConfirmationKind = "external_send" | "scheduled_job" | "skill_change";

export interface ToolConfirmationCandidate {
  kind: ToolConfirmationKind;
  toolName: string;
  /** Short, human-readable description of the action (subject, job or skill name). */
  summary: string;
  /** Optional preview of the content, bounded for display. */
  detail?: string;
  /** Normalized recipients (lowercased addresses, channel or user IDs). */
  recipients: string[];
  /** Integrations or capabilities the action enables (e.g. "gmail", "web_search"). */
  integrations: string[];
}

const SUMMARY_LIMIT = 200;
const DETAIL_LIMIT = 600;
const RECIPIENT_LIMIT = 50;

type Args = Record<string, unknown>;

const SEND_TOOLS: Record<string, (args: Args) => { recipients: string[]; summary: string; detail?: string }> = {
  gmail_send: emailRecipients,
  outlook_send: emailRecipients,
  slack_send_message: slackRecipients,
  slack_schedule_message: slackRecipients,
  ms_calendar_create: (args) => ({
    recipients: stringList(args.attendees).flatMap(splitAddresses),
    summary: text(args.summary),
    detail: text(args.description ?? args.body),
  }),
};

/** Tool names that can ever require confirmation; used to serialize them per round. */
export const CONFIRMATION_GATED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(SEND_TOOLS),
  "create_scheduled_job",
  "update_scheduled_job",
  "create_skill",
  "update_skill",
]);

export function isConfirmationGatedTool(toolName: string): boolean {
  return CONFIRMATION_GATED_TOOL_NAMES.has(toolName);
}

/**
 * Returns the confirmation candidate for a tool call, or null when the call
 * never needs confirmation. External sends are only *candidates*: the gate
 * still skips confirmation when every recipient was named by the user.
 */
export function confirmationCandidate(toolName: string, args: Args): ToolConfirmationCandidate | null {
  const send = SEND_TOOLS[toolName];
  if (send) {
    const { recipients, summary, detail } = send(args);
    return bounded({
      kind: "external_send",
      toolName,
      summary,
      detail,
      recipients: unique(recipients),
      integrations: [],
    });
  }
  if (toolName === "create_scheduled_job" || toolName === "update_scheduled_job") {
    const integrations = scheduledJobCapabilities(args);
    if (integrations.length === 0) return null;
    return bounded({
      kind: "scheduled_job",
      toolName,
      summary: text(args.name ?? args.jobName ?? args.jobId),
      detail: text(args.prompt ?? firstStepPrompt(args.steps)),
      recipients: [],
      integrations,
    });
  }
  if (toolName === "create_skill" || toolName === "update_skill") {
    return bounded({
      kind: "skill_change",
      toolName,
      summary: text(args.name ?? args.skillName ?? args.skillId),
      detail: text(args.summary ?? args.instructionsRaw),
      recipients: [],
      integrations: unique([
        ...stringList(args.requiredIntegrationIds),
        ...stringList(args.requiredToolProfiles),
      ]),
    });
  }
  return null;
}

/**
 * Recipients that the user did not name in their own messages. Matching is a
 * case-insensitive substring test against user-authored text only.
 */
export function unnamedRecipients(recipients: string[], userAuthoredTexts: string[]): string[] {
  const corpus = userAuthoredTexts.join("\n").toLowerCase();
  return recipients.filter((recipient) => !recipient || !corpus.includes(recipient.toLowerCase()));
}

export function scheduledJobCapabilities(args: Args): string[] {
  const capabilities: string[] = [];
  const collect = (source: Args) => {
    capabilities.push(...stringList(source.enabledIntegrations));
    if (source.webSearchEnabled === true) capabilities.push("web_search");
    if (source.searchMode === "web" || source.searchMode === "research") capabilities.push("web_search");
    const overrides = Array.isArray(source.turnIntegrationOverrides) ? source.turnIntegrationOverrides : [];
    for (const override of overrides) {
      if (isRecord(override) && override.enabled === true && typeof override.integrationId === "string") {
        capabilities.push(override.integrationId);
      }
    }
  };
  collect(args);
  if (Array.isArray(args.steps)) {
    for (const step of args.steps) if (isRecord(step)) collect(step);
  }
  return unique(capabilities.map((value) => value.trim()).filter(Boolean));
}

function emailRecipients(args: Args) {
  return {
    recipients: [args.to, args.cc, args.bcc].flatMap((value) => stringList(value).flatMap(splitAddresses)),
    summary: text(args.subject),
    detail: text(args.body),
  };
}

function slackRecipients(args: Args) {
  return {
    recipients: stringList(args.channel_id).map((value) => value.trim().toLowerCase()).filter(Boolean),
    summary: text(args.message),
    detail: undefined,
  };
}

/** Split "A <a@x.com>, b@y.com; c@z.com" into normalized addresses. */
export function splitAddresses(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => {
      const angle = /<([^>]+)>/.exec(part);
      return (angle ? angle[1] : part).trim().toLowerCase();
    })
    .filter(Boolean);
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function firstStepPrompt(steps: unknown): unknown {
  if (!Array.isArray(steps)) return undefined;
  const first = steps.find(isRecord);
  return first?.prompt;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(candidate: ToolConfirmationCandidate): ToolConfirmationCandidate {
  const { detail, ...rest } = candidate;
  return {
    ...rest,
    summary: candidate.summary.slice(0, SUMMARY_LIMIT),
    ...(detail ? { detail: detail.slice(0, DETAIL_LIMIT) } : {}),
    recipients: candidate.recipients.slice(0, RECIPIENT_LIMIT).map((value) => value.slice(0, 320)),
    integrations: candidate.integrations.slice(0, RECIPIENT_LIMIT).map((value) => value.slice(0, 80)),
  };
}
