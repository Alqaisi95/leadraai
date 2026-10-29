/** R2.1 — cron entrypoint for scheduled jobs. Same protection as drain. */
import { NextRequest, NextResponse } from "next/server";
import { runDueJobs } from "@/lib/jobs";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDueJobs());
}
