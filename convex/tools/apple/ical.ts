import { ConvexError } from "convex/values";

export interface AppleCalendarEventFields {
  uid: string;
  summary: string;
  startTime: string;
  endTime: string;
  description?: string;
  location?: string;
  timezone?: string;
}

export interface ParsedAppleCalendarEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  startTimezone?: string;
  end?: string;
  endTimezone?: string;
  isAllDay: boolean;
  sequence: number;
}

interface EncodedDateProperty {
  line: string;
  isAllDay: boolean;
}

export function parseAppleCalendarEvent(rawICal: string): ParsedAppleCalendarEvent {
  const lines = unfoldICalLines(rawICal);
  const summary = decodeICalText(readValue(lines, "SUMMARY"));
  const description = decodeICalText(readValue(lines, "DESCRIPTION"));
  const location = decodeICalText(readValue(lines, "LOCATION"));
  const uid = readValue(lines, "UID");
  const sequenceValue = readValue(lines, "SEQUENCE");
  const start = readDateProperty(lines, "DTSTART");
  const end = readDateProperty(lines, "DTEND");

  return {
    uid: uid || undefined,
    summary: summary || undefined,
    description: description || undefined,
    location: location || undefined,
    start: start.value,
    startTimezone: start.timezone,
    end: end.value,
    endTimezone: end.timezone,
    isAllDay: start.isAllDay,
    sequence: sequenceValue ? Number(sequenceValue) || 0 : 0,
  };
}

export function buildAppleCalendarEvent(
  event: AppleCalendarEventFields,
): string {
  const eventLines = buildStandardEventLines(event, 0);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NanthAI Edge//Apple Calendar//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    ...eventLines,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function updateAppleCalendarEvent(
  rawICal: string,
  patch: Partial<AppleCalendarEventFields>,
): string {
  const parsed = parseAppleCalendarEvent(rawICal);
  const lines = unfoldICalLines(rawICal);
  const beginIndex = lines.indexOf("BEGIN:VEVENT");
  const endIndex = lines.indexOf("END:VEVENT");

  if (beginIndex < 0 || endIndex < 0 || endIndex <= beginIndex) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: "The Apple Calendar event could not be parsed.",
    });
  }

  const merged: AppleCalendarEventFields = {
    uid: patch.uid ?? parsed.uid ?? crypto.randomUUID(),
    summary: patch.summary ?? parsed.summary ?? "(no title)",
    description: patch.description ?? parsed.description,
    location: patch.location ?? parsed.location,
    startTime: patch.startTime ?? parsed.start ?? "",
    endTime: patch.endTime ?? parsed.end ?? "",
    timezone: patch.timezone
      ?? parsed.startTimezone
      ?? parsed.endTimezone,
  };

  if (!merged.startTime || !merged.endTime) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: "Apple Calendar updates require a valid start and end time.",
    });
  }

  const preservedEventLines = lines
    .slice(beginIndex + 1, endIndex)
    .filter((line) => !isManagedEventLine(line));

  const updatedEventLines = [
    "BEGIN:VEVENT",
    ...buildStandardEventLines(merged, parsed.sequence + 1),
    ...preservedEventLines,
    "END:VEVENT",
  ];

  return [
    ...lines.slice(0, beginIndex),
    ...updatedEventLines,
    ...lines.slice(endIndex + 1),
  ].join("\r\n");
}

function buildStandardEventLines(
  event: AppleCalendarEventFields,
  sequence: number,
): string[] {
  const nowStamp = formatUTCDateTime(new Date().toISOString());
  const start = encodeDateProperty("DTSTART", event.startTime, event.timezone);
  const end = encodeDateProperty("DTEND", event.endTime, event.timezone);

  return [
    `UID:${event.uid}`,
    `DTSTAMP:${nowStamp}`,
    `LAST-MODIFIED:${nowStamp}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${escapeICalText(event.summary)}`,
    ...(event.description
      ? [`DESCRIPTION:${escapeICalText(event.description)}`]
      : []),
    ...(event.location
      ? [`LOCATION:${escapeICalText(event.location)}`]
      : []),
    start.line,
    end.line,
  ];
}

function encodeDateProperty(
  name: string,
  value: string,
  timezone?: string,
): EncodedDateProperty {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return {
      line: `${name};VALUE=DATE:${value.replaceAll("-", "")}`,
      isAllDay: true,
    };
  }

  if (!hasExplicitTimezone(value) && !timezone) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: `Apple Calendar ${name.toLowerCase()} requires either an ISO offset or a timezone.`,
    });
  }

  if (!hasExplicitTimezone(value) && timezone) {
    return {
      line: `${name};TZID=${timezone}:${formatFloatingDateTime(value)}`,
      isAllDay: false,
    };
  }

  return {
    line: `${name}:${formatUTCDateTime(value)}`,
    isAllDay: false,
  };
}

function readDateProperty(lines: string[], name: string) {
  const line = lines.find((entry) => entry.startsWith(`${name}`));
  if (!line) {
    return { value: undefined, timezone: undefined, isAllDay: false };
  }

  const [rawKey, rawValue = ""] = line.split(":", 2);
  const params = rawKey.split(";").slice(1);
  const isAllDay = params.some((param) => param === "VALUE=DATE");
  const timezone = params
    .find((param) => param.startsWith("TZID="))
    ?.slice("TZID=".length);

  if (isAllDay) {
    return {
      value: formatDateValue(rawValue),
      timezone: undefined,
      isAllDay: true,
    };
  }

  return {
    value: formatDateTimeValue(rawValue),
    timezone,
    isAllDay: false,
  };
}

function readValue(lines: string[], name: string): string | undefined {
  const line = lines.find((entry) => entry.startsWith(`${name}`));
  if (!line) return undefined;
  const [, value = ""] = line.split(":", 2);
  return value;
}

function unfoldICalLines(rawICal: string): string[] {
  return rawICal
    .replace(/\r\n[ \t]/g, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function isManagedEventLine(line: string): boolean {
  return [
    "UID",
    "DTSTART",
    "DTEND",
    "DTSTAMP",
    "LAST-MODIFIED",
    "SEQUENCE",
    "SUMMARY",
    "DESCRIPTION",
    "LOCATION",
  ].some((prefix) => line.startsWith(prefix));
}

function formatDateValue(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function formatDateTimeValue(value: string): string {
  const normalized = value.endsWith("Z") ? value.slice(0, -1) : value;
  const prefix = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
  const time = `${normalized.slice(9, 11)}:${normalized.slice(11, 13)}:${normalized.slice(13, 15)}`;
  return value.endsWith("Z") ? `${prefix}T${time}Z` : `${prefix}T${time}`;
}

function formatFloatingDateTime(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: "Apple Calendar requires local times in 'YYYY-MM-DDTHH:mm:ss' format when using timezone.",
    });
  }

  const [datePart, timePart] = trimmed.split("T");
  const safeTime = timePart.length === 5 ? `${timePart}:00` : timePart;
  return `${datePart.replaceAll("-", "")}T${safeTime.replaceAll(":", "")}`;
}

function formatUTCDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ConvexError({
      code: "INVALID_INPUT" as const,
      message: `Invalid Apple Calendar date/time: '${value}'.`,
    });
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim());
}

function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function decodeICalText(value?: string): string | undefined {
  return value
    ?.replace(/\\n/g, "\n")
    ?.replace(/\\,/g, ",")
    ?.replace(/\\;/g, ";")
    ?.replace(/\\\\/g, "\\");
}
