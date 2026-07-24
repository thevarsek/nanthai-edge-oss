export function localizedPublicDate(isoDate: string, language: string | undefined): string {
  return new Intl.DateTimeFormat(language ?? "en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}
