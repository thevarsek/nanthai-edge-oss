import { describe, expect, it } from "vitest";
import { shouldConfirmLink } from "./markdownLinkSpoofing";

describe("shouldConfirmLink", () => {
  it.each([
    ["https://accounts.google.com", "https://evil.example/login"],
    ["accounts.google.com", "https://evil.example/login"],
    ["www.paypal.com/signin", "https://paypal.com.evil.example"],
    ["google.com", "https://google.com.evil.example"],
    ["http://example.org", "https://example.com"],
  ])("confirms %s -> %s", (label, href) => {
    expect(shouldConfirmLink(label, href)).toBe(true);
  });

  it.each([
    ["https://example.com/a", "https://example.com/b"],
    ["example.com", "https://www.example.com/page"],
    ["www.example.com", "https://example.com"],
    ["example.com", "https://docs.example.com/guide"],
    ["Example.COM", "https://example.com"],
  ])("does not confirm matching hosts %s -> %s", (label, href) => {
    expect(shouldConfirmLink(label, href)).toBe(false);
  });

  it.each([
    ["Click here", "https://evil.example"],
    ["report.pdf", "https://cdn.example.com/report.pdf"],
    ["config.json", "https://example.com/config"],
    ["See example.com for more", "https://other.example"],
    ["", "https://evil.example"],
    ["example.com", "not a url"],
  ])("ignores non-domain labels %s -> %s", (label, href) => {
    expect(shouldConfirmLink(label, href)).toBe(false);
  });
});
