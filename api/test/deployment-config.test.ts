import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const wranglerConfig = readFileSync(resolve(__dirname, "../wrangler.toml"), "utf8");

function topLevelValue(name: string) {
  const beforeFirstTable = wranglerConfig.split(/\n\[/)[0] ?? "";
  return beforeFirstTable.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
}

describe("deployment config safety", () => {
  it("keeps the default Worker target away from production", () => {
    expect(topLevelValue("name")).toBe("northline-api-dev");
    expect(wranglerConfig).toContain("[env.production]");
    expect(wranglerConfig).toMatch(/\[env\.production\][\s\S]*?name\s*=\s*"northline-api"/);
  });

  it("keeps development auth behavior out of production-like Worker envs", () => {
    expect(wranglerConfig).toMatch(/\[vars\][\s\S]*?APP_ENV\s*=\s*"development"/);
    expect(wranglerConfig).toMatch(/\[env\.staging\.vars\][\s\S]*?APP_ENV\s*=\s*"staging"/);
    expect(wranglerConfig).toMatch(/\[env\.production\.vars\][\s\S]*?APP_ENV\s*=\s*"production"/);
  });
});
