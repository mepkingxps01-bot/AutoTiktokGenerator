import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./auth/session";
import { getConfig } from "./config";
import { AppError, Errors, toAppError } from "./errors";
import { getStore } from "./store";

export function jsonError(err: unknown) {
  const e = toAppError(err);
  if (e.status >= 500) console.error("[api]", e.code, e.details ?? e.message);
  const headers: Record<string, string> = {};
  if (e.code === "rate_limited") headers["Retry-After"] = String((e.details as { retryAfterSec: number }).retryAfterSec);
  return NextResponse.json(
    { error: { code: e.code, message: e.thaiMessage, details: e.status < 500 ? e.details : undefined } },
    { status: e.status, headers },
  );
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export async function isAuthenticated(req: NextRequest | Request): Promise<boolean> {
  const cookie = "cookies" in req ? (req as NextRequest).cookies.get(SESSION_COOKIE)?.value : parseCookie(req.headers.get("cookie"), SESSION_COOKIE);
  return verifySessionToken(cookie, getConfig().auth.sessionSecret);
}

function parseCookie(header: string | null, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export async function requireAuth(req: Request) {
  if (!(await isAuthenticated(req))) throw Errors.unauthorized();
}

export async function rateLimit(name: string, req: Request, max: number, windowSeconds: number) {
  const res = await getStore().hitRateLimit(`${name}:${clientIp(req)}`, windowSeconds, max);
  if (!res.allowed) {
    throw Errors.rateLimited(Math.max(1, Math.ceil((Date.parse(res.resetAt) - Date.now()) / 1000)));
  }
}

export function passwordMatches(input: string, expected: string) {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Wrap a route handler: auth (unless public), uniform Thai JSON errors. */
export function route<C>(handler: (req: NextRequest, ctx: C) => Promise<Response>, opts: { public?: boolean } = {}) {
  return async (req: NextRequest, ctx: C) => {
    try {
      if (!opts.public) await requireAuth(req);
      return await handler(req, ctx);
    } catch (e) {
      return jsonError(e);
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError("bad_json", "รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
  }
}

/** Worker endpoints accept a cron/worker secret OR a logged-in session. */
export async function isWorkerAuthorized(req: NextRequest) {
  const cfg = getConfig();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-worker-secret");
  for (const provided of [bearer, header]) {
    for (const secret of [cfg.cronSecret, cfg.workerSecret]) {
      if (provided && secret && passwordMatches(provided, secret)) return true;
    }
  }
  return isAuthenticated(req);
}
