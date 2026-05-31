export const NORTHLINE_TOKEN_STORAGE_KEY = "northline.apiToken";

export type RuntimeTokenPersistence = "session" | "local";

const tokenParamNames = ["access_token", "id_token", "token"];

function browserStorage(kind: RuntimeTokenPersistence): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  return kind === "local" ? window.localStorage : window.sessionStorage;
}

export function readRuntimeToken() {
  if (typeof window === "undefined") return undefined;
  return (
    window.sessionStorage.getItem(NORTHLINE_TOKEN_STORAGE_KEY) ??
    window.localStorage.getItem(NORTHLINE_TOKEN_STORAGE_KEY) ??
    undefined
  );
}

export function writeRuntimeToken(token: string, persistence: RuntimeTokenPersistence = "session") {
  const target = browserStorage(persistence);
  if (!target) return;

  clearRuntimeToken();
  target.setItem(NORTHLINE_TOKEN_STORAGE_KEY, token);
}

export function clearRuntimeToken() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(NORTHLINE_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(NORTHLINE_TOKEN_STORAGE_KEY);
}

export function requireRuntimeToken(devFallback?: string) {
  const token = readRuntimeToken() ?? devFallback;
  if (!token) {
    throw new Error("Missing API token. Sign in before using the Northline API.");
  }
  return token;
}

export function consumeRuntimeTokenFromUrl(persistence: RuntimeTokenPersistence = "session") {
  if (typeof window === "undefined") return undefined;

  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const searchParams = url.searchParams;
  const token = tokenParamNames
    .map((name) => hashParams.get(name) ?? searchParams.get(name))
    .find((value): value is string => Boolean(value));

  if (!token) return undefined;

  writeRuntimeToken(token, persistence);
  for (const name of tokenParamNames) {
    hashParams.delete(name);
    searchParams.delete(name);
  }

  url.search = searchParams.toString();
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";
  window.history.replaceState(window.history.state, "", url.toString());

  return token;
}
