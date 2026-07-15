import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(sourceDirectory, "..");

function readWebFile(relativePath: string): string {
  return fs.readFileSync(path.join(webDirectory, relativePath), "utf8");
}

describe("production auth deployment configuration", () => {
  it("serves both OpenRouter web callback paths through the SPA", () => {
    const netlifyConfig = readWebFile("netlify.toml");

    for (const callbackPath of ["/openrouter/callback", "/openrouter/callback/"]) {
      const escapedPath = callbackPath.replaceAll("/", "\\/");
      expect(netlifyConfig).toMatch(new RegExp(
        `\\[\\[redirects\\]\\]\\s+from = "${escapedPath}"\\s+to = "\\/index\\.html"\\s+status = 200`,
      ));
    }

    expect(netlifyConfig).not.toMatch(
      /\[\[redirects\]\]\s+from = "\/openrouter\/\*"\s+to = "\/index\.html"/,
    );
  });

  it("routes completed Clerk sign-ins and sign-ups through the app guard", () => {
    const appEntry = readWebFile("src/main.tsx");

    expect(appEntry).toContain('signInForceRedirectUrl="/app"');
    expect(appEntry).toContain('signUpForceRedirectUrl="/app"');
  });
});
