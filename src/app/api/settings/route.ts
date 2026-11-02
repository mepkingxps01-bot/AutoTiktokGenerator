import { NextResponse } from "next/server";
import { Errors } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { getStore } from "@/lib/store";
import { SettingsSchema } from "@/lib/types";

export const GET = route(async () => NextResponse.json({ settings: await getStore().getSettings() }));

export const PUT = route(async (req) => {
  const parsed = SettingsSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw Errors.badInput("ค่าที่ตั้งไม่ถูกต้อง", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return NextResponse.json({ settings: await getStore().saveSettings(parsed.data) });
});
