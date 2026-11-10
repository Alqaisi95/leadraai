/**
 * Serverless queue drain — for Vercel where long-running workers don't exist.
 * Triggered by Vercel Cron (or cron-job.org on the free plan) every minute.
 * Protected by CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { processBatch } from "@/lib/queue";
import { secretsMatch } from "@/lib/crypto";

export const maxDuration = 60; // seconds — AI calls need room

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !secretsMatch(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await processBatch(15);
  return NextResponse.json(result);
}
