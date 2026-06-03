function normalizeWeeklyMinutes(totalMinutes: number) {
  const minutesPerWeek = 7 * 24 * 60;
  return ((totalMinutes % minutesPerWeek) + minutesPerWeek) % minutesPerWeek;
}

export function utcWeeklyRecurrenceToLocal(
  dayOfWeek: number,
  hourUTC: number,
  minuteUTC: number,
  timezoneOffsetMinutes = new Date().getTimezoneOffset(),
) {
  const localTotalMinutes = normalizeWeeklyMinutes(
    dayOfWeek * 24 * 60 + hourUTC * 60 + minuteUTC - timezoneOffsetMinutes,
  );
  return {
    dayOfWeek: Math.floor(localTotalMinutes / (24 * 60)),
    hour: Math.floor((localTotalMinutes % (24 * 60)) / 60),
    minute: localTotalMinutes % 60,
  };
}

export function localWeeklyRecurrenceToUtc(
  dayOfWeek: number,
  hour: number,
  minute: number,
  timezoneOffsetMinutes = new Date().getTimezoneOffset(),
) {
  const utcTotalMinutes = normalizeWeeklyMinutes(
    dayOfWeek * 24 * 60 + hour * 60 + minute + timezoneOffsetMinutes,
  );
  return {
    dayOfWeek: Math.floor(utcTotalMinutes / (24 * 60)),
    hourUTC: Math.floor((utcTotalMinutes % (24 * 60)) / 60),
    minuteUTC: utcTotalMinutes % 60,
  };
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}

export function isValidRecurrenceTime(hour: number, minute: number): boolean {
  return isIntegerInRange(hour, 0, 23) && isIntegerInRange(minute, 0, 59);
}

export function parseLocalTimeInput(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!isValidRecurrenceTime(hour, minute)) return null;
  return { hour, minute };
}

export function isValidRecurrenceSelection({
  recurrenceType,
  intervalMinutes,
  dailyHour,
  dailyMinute,
  weeklyDay,
  cronExpression,
}: {
  recurrenceType: string;
  intervalMinutes: number;
  dailyHour: number;
  dailyMinute: number;
  weeklyDay: number;
  cronExpression: string;
}): boolean {
  switch (recurrenceType) {
    case "manual":
      return true;
    case "interval":
      return isIntegerInRange(intervalMinutes, 15, 1440);
    case "daily":
      return isValidRecurrenceTime(dailyHour, dailyMinute);
    case "weekly":
      return isIntegerInRange(weeklyDay, 0, 6) && isValidRecurrenceTime(dailyHour, dailyMinute);
    case "cron":
      return cronExpression.trim().length > 0;
    default:
      return false;
  }
}
