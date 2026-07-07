const APPS = [
  {
    id: "web",
    name: "Web Portal",
    url: "http://127.0.0.1:4173/",
    title: "Northline Command Portal"
  },
  {
    id: "mobile",
    name: "Mobile Ops",
    url: "http://127.0.0.1:4174/",
    title: "Northline Field Ops"
  },
  {
    id: "tablet",
    name: "Tablet Ops",
    url: "http://127.0.0.1:4175/",
    title: "Northline Tablet Ops"
  }
];

const APP_IDS = new Set(APPS.map((app) => app.id));

function parseArgs(argv) {
  const args = {
    only: null,
    timeoutMs: 5000,
    urls: new Map()
  };

  for (const arg of argv) {
    if (arg === "--") continue;
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}". Use --only, --timeout-ms, or --<app>-url.`);
    }

    const normalized = arg.slice(2);
    const separator = normalized.indexOf("=");
    const key = separator === -1 ? normalized : normalized.slice(0, separator);
    const value = separator === -1 ? "" : normalized.slice(separator + 1);
    if (key === "only") {
      args.only = new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
    } else if (key === "timeout-ms") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) args.timeoutMs = parsed;
    } else if (key?.endsWith("-url")) {
      const appId = key.slice(0, -"url".length - 1);
      if (!APP_IDS.has(appId)) {
        throw new Error(`Unknown app URL override "${key}". Use one of: ${APPS.map((app) => `--${app.id}-url`).join(", ")}`);
      }
      args.urls.set(appId, value);
    } else {
      throw new Error(`Unknown argument "--${key}". Use --only, --timeout-ms, or --<app>-url.`);
    }
  }

  if (args.only) {
    const unknownIds = [...args.only].filter((id) => !APP_IDS.has(id));
    if (unknownIds.length > 0) {
      throw new Error(`Unknown app id in --only: ${unknownIds.join(", ")}. Use one or more of: ${[...APP_IDS].join(", ")}`);
    }
  }

  return args;
}

function pageTitle(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function verifyApp(app, args) {
  const url = args.urls.get(app.id) ?? app.url;
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${app.name} URL is invalid: ${url}`);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${app.name} URL must use http or https: ${url}`);
  }

  let response;
  try {
    response = await fetch(url, { signal: timeoutSignal(args.timeoutMs) });
  } catch (error) {
    throw new Error(`${app.name} at ${url} is not reachable: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`${app.name} at ${url} returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const actualTitle = pageTitle(html);
  if (actualTitle !== app.title) {
    throw new Error(`${app.name} at ${url} served "${actualTitle || "<no title>"}"; expected "${app.title}"`);
  }

  if (!html.includes('id="root"')) {
    throw new Error(`${app.name} at ${url} does not contain the expected React root element`);
  }

  return { ...app, url, actualTitle };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = args.only ? APPS.filter((app) => args.only.has(app.id)) : APPS;
  if (selected.length === 0) {
    throw new Error(`No apps selected. Use one or more of: ${APPS.map((app) => app.id).join(", ")}`);
  }

  const results = [];
  for (const app of selected) {
    results.push(await verifyApp(app, args));
  }

  for (const result of results) {
    console.log(`ok ${result.id}: ${result.actualTitle} (${result.url})`);
  }
}

main().catch((error) => {
  console.error(`App identity verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
