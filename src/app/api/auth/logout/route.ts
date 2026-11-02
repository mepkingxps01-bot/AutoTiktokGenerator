import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { route } from "@/lib/http";

export const POST = route(
  async () => {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  },
  { public: true },
);
