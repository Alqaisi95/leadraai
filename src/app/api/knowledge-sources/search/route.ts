/** GET /api/knowledge-sources/search?q=&projectId= — what the AI would retrieve for a question. */
import { NextResponse } from "next/server";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { searchKnowledge } from "@/lib/ai/knowledge";

export const GET = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "knowledge.manage");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return err(422, "VALIDATION", "q is required", correlationId);
  const items = await searchKnowledge(ctx.organizationId, q, url.searchParams.get("projectId"), 4);
  return NextResponse.json({ items });
});
