/**
 * Long-running worker (VPS / Railway / Render option).
 * On Vercel, use /api/worker/drain + cron instead — same core logic (src/lib/queue.ts).
 * Run: npm run worker
 */
import { processBatch } from "../src/lib/queue";

const POLL_MS = 1500;

async function loop() {
  console.log("Leadra worker started — polling webhook_events");
  for (;;) {
    const { processed } = await processBatch(20);
    if (processed === 0) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop().catch((e) => { console.error(e); process.exit(1); });
