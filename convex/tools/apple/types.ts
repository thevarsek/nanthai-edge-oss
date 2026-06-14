export type AppleDAVCalendar = {
  url: string;
  displayName?: unknown;
  timezone?: string;
  calendarColor?: string;
  components?: string[];
};

export type AppleDAVCalendarObject = {
  url?: string;
  etag?: string;
  data?: string;
};

export type AppleDAVClient = {
  fetchCalendars: () => Promise<AppleDAVCalendar[]>;
  fetchCalendarObjects: (args: {
    calendar: AppleDAVCalendar;
    objectUrls?: string[];
    timeRange?: { start: string; end: string };
    expand?: boolean;
    useMultiGet?: boolean;
  }) => Promise<AppleDAVCalendarObject[]>;
  createCalendarObject: (args: {
    calendar: AppleDAVCalendar;
    iCalString: string;
    filename: string;
  }) => Promise<Response>;
  updateCalendarObject: (args: {
    calendarObject: AppleDAVCalendarObject;
  }) => Promise<Response>;
  deleteCalendarObject: (args: {
    calendarObject: AppleDAVCalendarObject;
  }) => Promise<Response>;
};

export type CreateAppleDAVClient = (params: {
  serverUrl: string;
  credentials: {
    username: string;
    password: string;
  };
  authMethod: "Basic";
  defaultAccountType: "caldav";
  fetch: typeof fetch;
}) => Promise<AppleDAVClient>;
