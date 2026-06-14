import { ConvexError } from "convex/values";
import type {
  AppleDAVCalendar,
  AppleDAVCalendarObject,
  AppleDAVClient,
} from "./types";

const ICLOUD_CALDAV_SERVER_URL = "https://caldav.icloud.com";
const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const CALENDAR_SERVER_NS = "http://calendarserver.org/ns/";

export interface AppleCalendarCredentials {
  username: string;
  appSpecificPassword: string;
}

export interface AppleCalendarSummary {
  id: string;
  displayName?: string;
  timezone?: string;
  color?: string;
}

export async function createAppleCalendarClient(
  credentials: AppleCalendarCredentials,
): Promise<AppleDAVClient> {
  return new AppleCalendarDAVClient(credentials);
}

class AppleCalendarDAVClient implements AppleDAVClient {
  private readonly authHeader: string;

  constructor(credentials: AppleCalendarCredentials) {
    this.authHeader = `Basic ${btoa(`${credentials.username}:${credentials.appSpecificPassword}`)}`;
  }

  async fetchCalendars(): Promise<AppleDAVCalendar[]> {
    const principalUrl = await this.currentUserPrincipal();
    const homeSetUrl = await this.calendarHomeSet(principalUrl);
    const responses = await this.propfind(homeSetUrl, "1", `
      <d:prop>
        <d:displayname />
        <cs:getctag />
        <cal:calendar-color />
        <cal:calendar-timezone />
        <cal:supported-calendar-component-set />
        <d:resourcetype />
      </d:prop>
    `);

    return responses.flatMap((response) => {
      const href = responseHref(response);
      const prop = responseProp(response);
      if (!href || !isCalendarResource(propValue(prop, "resourcetype"))) {
        return [];
      }
      return [{
        url: absoluteUrl(href),
        displayName: stringValue(propValue(prop, "displayname")),
        timezone: stringValue(propValue(prop, "calendar-timezone")),
        calendarColor: stringValue(propValue(prop, "calendar-color")),
        components: calendarComponents(
          propValue(prop, "supported-calendar-component-set"),
        ),
      }];
    });
  }

  async fetchCalendarObjects(args: {
    calendar: AppleDAVCalendar;
    objectUrls?: string[];
    timeRange?: { start: string; end: string };
    expand?: boolean;
    useMultiGet?: boolean;
  }): Promise<AppleDAVCalendarObject[]> {
    const body = args.objectUrls && args.objectUrls.length > 0
      ? calendarMultigetBody(args.objectUrls)
      : calendarQueryBody(args.timeRange);
    const responses = await this.report(args.calendar.url, body);

    return responses.flatMap((response) => {
      const href = responseHref(response);
      const prop = responseProp(response);
      const data = stringValue(propValue(prop, "calendar-data"));
      if (!href || data == null) {
        return [];
      }
      return [{
        url: absoluteUrl(href),
        etag: stringValue(propValue(prop, "getetag")),
        data,
      }];
    });
  }

  async createCalendarObject(args: {
    calendar: AppleDAVCalendar;
    iCalString: string;
    filename: string;
  }): Promise<Response> {
    return await this.request(new URL(args.filename, args.calendar.url).toString(), {
      method: "PUT",
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
      body: args.iCalString,
    });
  }

  async updateCalendarObject(args: {
    calendarObject: AppleDAVCalendarObject;
  }): Promise<Response> {
    if (!args.calendarObject.url) {
      throw new ConvexError({
        code: "VALIDATION" as const,
        message: "Apple Calendar event URL is required for updates.",
      });
    }
    return await this.request(args.calendarObject.url, {
      method: "PUT",
      headers: { "Content-Type": "text/calendar; charset=utf-8" },
      body: args.calendarObject.data ?? "",
    });
  }

  async deleteCalendarObject(args: {
    calendarObject: AppleDAVCalendarObject;
  }): Promise<Response> {
    if (!args.calendarObject.url) {
      throw new ConvexError({
        code: "VALIDATION" as const,
        message: "Apple Calendar event URL is required for deletion.",
      });
    }
    return await this.request(args.calendarObject.url, { method: "DELETE" });
  }

  private async currentUserPrincipal(): Promise<string> {
    const responses = await this.propfind(ICLOUD_CALDAV_SERVER_URL, "0", `
      <d:prop>
        <d:current-user-principal />
      </d:prop>
    `);
    const principal = responses
      .map((response) =>
        hrefFromValue(propValue(responseProp(response), "current-user-principal"))
      )
      .find((href): href is string => href != null);
    if (!principal) {
      throw new ConvexError({
        code: "EXTERNAL_SERVICE" as const,
        message: "Apple Calendar did not return a CalDAV principal.",
      });
    }
    return absoluteUrl(principal);
  }

  private async calendarHomeSet(principalUrl: string): Promise<string> {
    const responses = await this.propfind(principalUrl, "0", `
      <d:prop>
        <cal:calendar-home-set />
      </d:prop>
    `);
    const homeSet = responses
      .map((response) =>
        hrefFromValue(propValue(responseProp(response), "calendar-home-set"))
      )
      .find((href): href is string => href != null);
    if (!homeSet) {
      throw new ConvexError({
        code: "EXTERNAL_SERVICE" as const,
        message: "Apple Calendar did not return a CalDAV calendar home.",
      });
    }
    return absoluteUrl(homeSet);
  }

  private async propfind(
    url: string,
    depth: "0" | "1",
    propXml: string,
  ): Promise<Record<string, unknown>[]> {
    return await this.davXmlRequest(url, "PROPFIND", depth, `
      <d:propfind xmlns:d="${DAV_NS}" xmlns:cal="${CALDAV_NS}" xmlns:cs="${CALENDAR_SERVER_NS}">
        ${propXml}
      </d:propfind>
    `);
  }

  private async report(
    url: string,
    body: string,
  ): Promise<Record<string, unknown>[]> {
    return await this.davXmlRequest(url, "REPORT", "1", body);
  }

  private async davXmlRequest(
    url: string,
    method: string,
    depth: "0" | "1",
    body: string,
  ): Promise<Record<string, unknown>[]> {
    const response = await this.request(url, {
      method,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Depth: depth,
      },
      body,
    });
    const text = await response.text();
    if (!response.ok && response.status !== 207) {
      throw new ConvexError({
        code: "EXTERNAL_SERVICE" as const,
        message: `Apple Calendar ${method} failed (HTTP ${response.status}): ${text}`,
      });
    }
    return multistatusResponses(text);
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/xml,text/calendar,*/*",
        ...(init.headers ?? {}),
      },
    });
  }
}

export async function discoverCalendarsForCredentials(
  credentials: AppleCalendarCredentials,
): Promise<AppleDAVCalendar[]> {
  const client = await createAppleCalendarClient(credentials);
  const calendars = await client.fetchCalendars();
  return calendars.filter((calendar) => {
    if (!calendar.url) return false;
    if (!calendar.components || calendar.components.length === 0) return true;
    return calendar.components.includes("VEVENT");
  });
}

export async function discoverAppleCalendars(
  credentials: AppleCalendarCredentials,
): Promise<AppleCalendarSummary[]> {
  const calendars = await discoverCalendarsForCredentials(credentials);
  return calendars.map((calendar) => ({
    id: calendar.url,
    displayName:
      typeof calendar.displayName === "string"
        ? calendar.displayName
        : undefined,
    timezone: calendar.timezone,
    color: calendar.calendarColor,
  }));
}

export function findCalendarById(
  calendars: AppleDAVCalendar[],
  calendarId?: string,
): AppleDAVCalendar {
  if (calendars.length === 0) {
    throw new ConvexError({
      code: "NOT_FOUND" as const,
      message: "No Apple calendars are available for this account.",
    });
  }

  if (!calendarId) {
    return calendars[0];
  }

  const calendar = calendars.find((entry) => entry.url === calendarId);
  if (!calendar) {
    throw new ConvexError({
      code: "NOT_FOUND" as const,
      message: `Apple Calendar '${calendarId}' was not found for this account.`,
    });
  }
  return calendar;
}

function multistatusResponses(xml: string): Record<string, unknown>[] {
  return tagBlocks(xml, "response").map((responseXml) => {
    const propXml = tagTextRaw(responseXml, "prop") ?? "";
    const components = componentNames(propXml);
    const prop: Record<string, unknown> = {};
    for (const name of [
      "displayname",
      "calendar-timezone",
      "calendar-color",
      "getetag",
      "calendar-data",
    ]) {
      const value = tagText(propXml, name);
      if (value !== undefined) {
        prop[name] = value;
      }
    }

    const principalHref = nestedHref(propXml, "current-user-principal");
    if (principalHref !== undefined) {
      prop["current-user-principal"] = { href: principalHref };
    }

    const homeSetHref = nestedHref(propXml, "calendar-home-set");
    if (homeSetHref !== undefined) {
      prop["calendar-home-set"] = { href: homeSetHref };
    }

    if (hasTag(propXml, "resourcetype") && hasTag(tagTextRaw(propXml, "resourcetype") ?? "", "calendar")) {
      prop.resourcetype = { calendar: {} };
    }

    if (components.length > 0) {
      prop["supported-calendar-component-set"] = {
        comp: components.map((name) => ({ "@_name": name })),
      };
    }

    return {
      href: tagText(responseXml, "href"),
      propstat: { prop },
    };
  });
}

function responseHref(response: Record<string, unknown>): string | undefined {
  return stringValue(response.href);
}

function responseProp(response: Record<string, unknown>): Record<string, unknown> {
  const propstat = asArray(response.propstat).find(isRecord);
  const prop = propstat?.prop;
  return isRecord(prop) ? prop : {};
}

function propValue(prop: Record<string, unknown>, name: string): unknown {
  return prop[name];
}

function hrefFromValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  return stringValue(value.href);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function isCalendarResource(value: unknown): boolean {
  return isRecord(value) && value.calendar !== undefined;
}

function calendarComponents(value: unknown): string[] | undefined {
  if (!isRecord(value)) return undefined;
  const components = asArray(value.comp).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const name = stringValue(entry["@_name"]);
    return name ? [name] : [];
  });
  return components.length > 0 ? components : undefined;
}

function calendarMultigetBody(objectUrls: string[]): string {
  const hrefs = objectUrls
    .map((url) => `<d:href>${escapeXml(url)}</d:href>`)
    .join("");
  return `
    <cal:calendar-multiget xmlns:d="${DAV_NS}" xmlns:cal="${CALDAV_NS}">
      <d:prop>
        <d:getetag />
        <cal:calendar-data />
      </d:prop>
      ${hrefs}
    </cal:calendar-multiget>
  `;
}

function calendarQueryBody(timeRange?: { start: string; end: string }): string {
  const timeRangeXml = timeRange
    ? `<cal:time-range start="${formatCalDAVTimestamp(timeRange.start)}" end="${formatCalDAVTimestamp(timeRange.end)}" />`
    : "";
  return `
    <cal:calendar-query xmlns:d="${DAV_NS}" xmlns:cal="${CALDAV_NS}">
      <d:prop>
        <d:getetag />
        <cal:calendar-data />
      </d:prop>
      <cal:filter>
        <cal:comp-filter name="VCALENDAR">
          <cal:comp-filter name="VEVENT">
            ${timeRangeXml}
          </cal:comp-filter>
        </cal:comp-filter>
      </cal:filter>
    </cal:calendar-query>
  `;
}

function formatCalDAVTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replaceAll(/[-:]/g, "").replace(/\.\d{3}/, "");
  }
  return date.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function absoluteUrl(href: string): string {
  return new URL(href, ICLOUD_CALDAV_SERVER_URL).toString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function tagBlocks(xml: string, localName: string): string[] {
  return regexMatches(
    xml,
    new RegExp(`<${namespacedTagPattern(localName)}\\b[^>]*>([\\s\\S]*?)<\\/${namespacedTagPattern(localName)}>`, "gi"),
  ).map((match) => match[1] ?? "");
}

function tagText(xml: string, localName: string): string | undefined {
  const raw = tagTextRaw(xml, localName);
  return raw === undefined ? undefined : decodeXml(raw.trim());
}

function tagTextRaw(xml: string, localName: string): string | undefined {
  return new RegExp(
    `<${namespacedTagPattern(localName)}\\b[^>]*>([\\s\\S]*?)<\\/${namespacedTagPattern(localName)}>`,
    "i",
  ).exec(xml)?.[1];
}

function hasTag(xml: string, localName: string): boolean {
  return new RegExp(`<${namespacedTagPattern(localName)}(?:\\s|>|/)`, "i").test(xml);
}

function nestedHref(xml: string, localName: string): string | undefined {
  const block = tagTextRaw(xml, localName);
  return block === undefined ? undefined : tagText(block, "href");
}

function componentNames(xml: string): string[] {
  return regexMatches(
    xml,
    new RegExp(`<${namespacedTagPattern("comp")}\\b([^>]*)\\/?>`, "gi"),
  ).flatMap((match) => {
    const name = /\bname=(?:"([^"]+)"|'([^']+)')/i.exec(match[1] ?? "");
    return name?.[1] ?? name?.[2] ?? [];
  });
}

function namespacedTagPattern(localName: string): string {
  return `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
}

function regexMatches(value: string, regex: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  for (let match = regex.exec(value); match != null; match = regex.exec(value)) {
    matches.push(match);
  }
  return matches;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
