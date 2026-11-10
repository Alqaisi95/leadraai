/** R2.1 — cron entrypoint for scheduled jobs. Same protection as drain. */
import { NextRequest, NextResponse } from "next/server";
import { runDueJobs } from "@/lib/jobs";
import { secretsMatch } from "@/lib/crypto";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretsMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDueJobs());
}
