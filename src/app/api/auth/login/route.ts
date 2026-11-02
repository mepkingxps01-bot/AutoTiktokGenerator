import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { AppError, Errors } from "@/lib/errors";
import { passwordMatches, rateLimit, readJson, route } from "@/lib/http";

export const POST = route(
  async (req) => {
    await rateLimit("login", req, 10, 15 * 60);
    const cfg = getConfig();
    if (!cfg.auth.password || !cfg.auth.sessionSecret || cfg.auth.sessionSecret.length < 32) {
      throw Errors.config("ต้องตั้ง DASHBOARD_PASSWORD และ SESSION_SECRET (อย่างน้อย 32 ตัวอักษร)");
    }
    if (process.env.NODE_ENV === "production" && ["change-me", "password", "admin"].includes(cfg.auth.password)) {
      throw Errors.config("DASHBOARD_PASSWORD ง่ายเกินไปสำหรับ production");
    }
    const body = await readJson<{ password?: unknown }>(req);
    if (typeof body.password !== "string" || !passwordMatches(body.password, cfg.auth.password)) {
      throw new AppError("bad_password", "รหัสผ่านไม่ถูกต้อง", 401);
    }
    const token = await createSessionToken(cfg.auth.sessionSecret, cfg.auth.sessionHours);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: cfg.auth.sessionHours * 3600,
    });
    return res;
  },
  { public: true },
);
