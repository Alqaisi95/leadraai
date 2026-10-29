/**
 * Knowledge Base retrieval (§4.5).
 * Phase 4a: PostgreSQL full-text search (works today, no extra infra).
 * Phase 4b: pgvector semantic search — migration in prisma/manual/pgvector.sql;
 *           swap searchKnowledge() implementation, interface stays identical.
 */
import { prisma } from "../db";

export interface KnowledgeChunk {
  content: string;
  sourceTitle: string;
  sourceId: string;
}

export async function searchKnowledge(
  organizationId: string,
  query: string,
  projectId?: string | null,
  limit = 4
): Promise<KnowledgeChunk[]> {
  const terms = query.split(/\s+/).filter((t) => t.length > 2).slice(0, 8);
  if (terms.length === 0) return [];

  const docs = await prisma.knowledgeDocument.findMany({
    where: {
      source: {
        organizationId,
        status: "ACTIVE",
        ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}),
      },
      OR: terms.map((t) => ({ content: { contains: t, mode: "insensitive" as const } })),
    },
    include: { source: { select: { id: true, title: true } } },
    take: limit * 3,
  });

  // rank by how many terms matched
  return docs
    .map((d) => ({
      chunk: { content: d.content.slice(0, 1200), sourceTitle: d.source.title, sourceId: d.source.id },
      hits: terms.filter((t) => d.content.toLowerCase().includes(t.toLowerCase())).length,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.chunk);
}

/** Simple chunker for uploaded text content (~800 chars, sentence-aware). */
export function chunkText(text: string, size = 800): string[] {
  const sentences = text.split(/(?<=[.!؟?\n])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > size && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += s + " ";
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
