import { NextResponse } from "next/server";
import { publicRuntimeInfo } from "@/lib/config";
import { route } from "@/lib/http";
import { getStore } from "@/lib/store";
import { bangkokDay, bangkokMonthStartIso } from "@/lib/time";

export const GET = route(async () => {
  const store = getStore();
  const settings = await store.getSettings();
  const dayStart = new Date(`${bangkokDay()}T00:00:00+07:00`).toISOString();
  const [month, today] = await Promise.all([store.usageSince(bangkokMonthStartIso()), store.usageSince(dayStart)]);
  return NextResponse.json({
    runtime: publicRuntimeInfo(),
    usage: {
      monthCostUsd: Number(month.costUsd.toFixed(4)),
      monthBudgetUsd: settings.quotas.monthlyBudgetUsd,
      todayCarousels: today.carousels,
      dailyQuota: settings.quotas.dailyCarousels,
    },
  });
});
