import { z } from "zod";

const routeParamSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export type RouteParamResult =
  | { ok: true; value: string }
  | { ok: false; error: { error: "invalid_route_param"; param: string; message: string } };

export function validateRouteParam(param: string, value: string): RouteParamResult {
  const parsed = routeParamSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  return {
    ok: false,
    error: {
      error: "invalid_route_param",
      param,
      message: "route parameter must be 1-128 URL-safe identifier characters"
    }
  };
}

export interface QueryParamOptions {
  maxLength?: number;
  pattern?: RegExp;
}

export type QueryParamResult =
  | { ok: true; value: string | undefined }
  | { ok: false; error: { error: "invalid_query_param"; param: string; message: string } };

export function validateOptionalQueryParam(
  param: string,
  value: string | undefined,
  options: QueryParamOptions = {}
): QueryParamResult {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  const maxLength = options.maxLength ?? 128;
  const pattern = options.pattern ?? /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
  if (value.length < 1 || value.length > maxLength || !pattern.test(value)) {
    return {
      ok: false,
      error: {
        error: "invalid_query_param",
        param,
        message: `query parameter must be 1-${maxLength} URL-safe identifier characters`
      }
    };
  }

  return { ok: true, value };
}

export interface IntegerQueryOptions {
  defaultValue: number;
  min: number;
  max: number;
}

export type IntegerQueryResult =
  | { ok: true; value: number }
  | { ok: false; error: { error: "invalid_query_param"; param: string; message: string } };

export function parseBoundedIntegerQueryParam(
  param: string,
  value: string | undefined,
  options: IntegerQueryOptions
): IntegerQueryResult {
  if (value === undefined) {
    return { ok: true, value: options.defaultValue };
  }

  if (!/^\d+$/.test(value)) {
    return {
      ok: false,
      error: {
        error: "invalid_query_param",
        param,
        message: `query parameter must be an integer between ${options.min} and ${options.max}`
      }
    };
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.min || parsed > options.max) {
    return {
      ok: false,
      error: {
        error: "invalid_query_param",
        param,
        message: `query parameter must be an integer between ${options.min} and ${options.max}`
      }
    };
  }

  return { ok: true, value: parsed };
}
