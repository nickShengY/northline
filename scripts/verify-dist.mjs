import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const apps = ["web-portal", "mobile-ops", "tablet-ops"];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".webmanifest"]);
const forbiddenPatterns = [
  /demoTenant/i,
  /portal_admin/i,
  /captain_001/i,
  /crew_1/i,
  /VITE_DEV_TOKEN/,
  /VITE_API_TOKEN/
];
const manifestFields = [
  "name",
  "short_name",
  "description",
  "theme_color",
  "background_color",
  "display",
  "scope",
  "start_url",
  "icons"
];

const failures = [];

function walkFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function extensionOf(file) {
  const index = file.lastIndexOf(".");
  return index === -1 ? "" : file.slice(index);
}

for (const app of apps) {
  const distDir = join(process.cwd(), "apps", app, "dist");
  if (!existsSync(distDir)) {
    failures.push(`${app}: missing dist directory`);
    continue;
  }

  const files = walkFiles(distDir);
  const mapFiles = files.filter((file) => file.endsWith(".map"));
  if (mapFiles.length > 0 && process.env.ALLOW_PUBLIC_SOURCEMAPS !== "true") {
    failures.push(`${app}: public source maps are not allowed by default (${mapFiles.map((file) => relative(process.cwd(), file)).join(", ")})`);
  }

  for (const file of files) {
    if (!textExtensions.has(extensionOf(file))) continue;
    const text = readFileSync(file, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(text)) {
        failures.push(`${relative(process.cwd(), file)} contains forbidden production asset text: ${pattern}`);
      }
    }
  }

  const manifestPath = join(distDir, "manifest.webmanifest");
  if (!existsSync(manifestPath)) {
    failures.push(`${app}: missing manifest.webmanifest`);
    continue;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const field of manifestFields) {
    if (manifest[field] === undefined) {
      failures.push(`${app}: manifest missing ${field}`);
    }
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    failures.push(`${app}: manifest icons must be non-empty`);
  }
  if (!Array.isArray(manifest.shortcuts) || manifest.shortcuts.length === 0) {
    failures.push(`${app}: manifest shortcuts must be non-empty`);
  }

  const htmlPath = join(distDir, "index.html");
  if (!existsSync(htmlPath)) {
    failures.push(`${app}: missing index.html`);
    continue;
  }
  const html = readFileSync(htmlPath, "utf8");
  if (!html.includes('rel="apple-touch-icon"')) {
    failures.push(`${app}: missing apple-touch-icon link`);
  }
  if (!html.includes("viewport-fit=cover")) {
    failures.push(`${app}: viewport does not include viewport-fit=cover`);
  }
  if (statSync(htmlPath).size === 0) {
    failures.push(`${app}: index.html is empty`);
  }
}

if (failures.length > 0) {
  console.error("Distribution verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Distribution verification passed.");
