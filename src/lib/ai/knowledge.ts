/**
 * Knowledge Base retrieval (§4.5).
 * Hybrid lexical search: Postgres full-text ranking (ts_rank) blended with
 * trigram similarity, so both exact term hits and near-misses/typos rank.
 * Arabic has no core Postgres stemmer — 'simple' tokenizes without stemming,
 * and the trigram half covers the morphological variation a stemmer would.
 *
 * Semantic (pgvector) retrieval remains the next step; it needs an embeddings
 * provider, so the interface below is kept stable for that swap.
 */
import { prisma } from "../db";

export interface KnowledgeChunk {
  content: string;
  sourceTitle: string;
  sourceId: string;
}

interface Row {
  content: string;
  source_id: string;
  source_title: string;
  score: number;
}

export async function searchKnowledge(
  organizationId: string,
  query: string,
  projectId?: string | null,
  limit = 4,
): Promise<KnowledgeChunk[]> {
  const cleaned = query.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const terms = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);
  if (terms.length === 0) return [];

  const tsQuery = terms.join(" | ");
  const similarityTarget = terms.join(" ");

  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT d."content",
             s."id"    AS source_id,
             s."title" AS source_title,
             (ts_rank(d."content_tsv", to_tsquery('simple', ${tsQuery}))
               + similarity(d."content", ${similarityTarget})) AS score
      FROM "knowledge_documents" d
      JOIN "knowledge_sources" s ON s."id" = d."sourceId"
      WHERE s."organizationId" = ${organizationId}
        AND s."status" = 'ACTIVE'
        AND (${projectId ?? null}::text IS NULL
             OR s."projectId" = ${projectId ?? null}
             OR s."projectId" IS NULL)
        AND (d."content_tsv" @@ to_tsquery('simple', ${tsQuery})
             OR d."content" % ${similarityTarget})
      ORDER BY score DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      content: r.content.slice(0, 1200),
      sourceTitle: r.source_title,
      sourceId: r.source_id,
    }));
  } catch {
    // index/extension not present yet (fresh DB mid-migration) — fall back to
    // the portable LIKE scan rather than leaving the assistant with no context
    return fallbackSearch(organizationId, terms, projectId, limit);
  }
}

async function fallbackSearch(
  organizationId: string,
  terms: string[],
  projectId: string | null | undefined,
  limit: number,
): Promise<KnowledgeChunk[]> {
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
