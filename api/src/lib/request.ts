import type { Context } from "hono";

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: Response };

/**
 * Reads and parses the request body as JSON without letting malformed input
 * bubble up as an unhandled SyntaxError (raw 500). Returns a 400 response
 * with a stable error code instead.
 */
export async function readJsonBody(c: Context<any, any, any>): Promise<JsonBodyResult> {
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) {
    const requestId = c.req.header("x-request-id") ?? c.res.headers.get("x-request-id") ?? crypto.randomUUID();
    return {
      ok: false,
      response: c.json({
        error: "invalid_payload",
        message: "request body must be valid JSON",
        request_id: requestId
      }, 400)
    };
  }
  return { ok: true, body };
}
