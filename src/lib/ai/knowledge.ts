/**
 * Knowledge Base retrieval (§4.5).
 *
 * Arabic-aware keyword search, no extra infrastructure:
 *  - the SAME normalization runs on the question (JS) and on stored text (SQL):
 *    tashkeel/tatweel removed, أ/إ/آ/ٱ → ا, ى → ي, ة → ه, lower-case
 *  - Iraqi/Gulf filler words are dropped ("شنو", "عدكم", "ابي"…)
 *  - leading "ال" / "وال" / "بال"… is stripped, so "الأقساط" finds "اقساط"
 *  - real-estate synonyms are grouped into one concept ("قسط" ≈ "تقسيط" ≈ "اقساط")
 * Results are ranked by how many distinct concepts a chunk covers.
 * Phase 4b swaps in pgvector behind the same interface (prisma/manual/pgvector.sql).
 */
import { prisma } from "../db";

export interface KnowledgeChunk {
  content: string;
  sourceTitle: string;
  sourceId: string;
}

// ---------- normalization (must match NORMALIZE_SQL below) ----------
const TASHKEEL = /[ً-ْٰـ]/g;
const ARABIC_DIGITS = /[٠-٩]/g;

export function normalizeArabic(text: string): string {
  return text
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(ARABIC_DIGITS, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .toLowerCase();
}

/** SQL twin of normalizeArabic() for a column expression. */
const NORMALIZE_SQL = (col: string) =>
  `lower(translate(regexp_replace(${col}, '[ً-ْٰـ]', '', 'g'), 'أإآٱىة٠١٢٣٤٥٦٧٨٩', 'اااايه0123456789'))`;

// ---------- query understanding ----------
const STOPWORDS = new Set(
  [
    // dialect & MSA question/filler words (already normalized)
    "شنو", "شلون", "ايش", "وش", "شو", "شكد", "منو", "وين", "متي", "كم", "ليش", "لماذا", "ماذا", "هل",
    "اريد", "اريد", "ابي", "ابغي", "ابغا", "بدي", "حابب", "اود", "ممكن", "لو", "بس", "اذا", "يعني",
    "عدكم", "عندكم", "عندك", "لديكم", "عدك", "فيه", "اكو", "ماكو", "موجود", "متوفر",
    "هاي", "هذا", "هذه", "هذي", "هاذا", "ذلك", "تلك", "هناك", "هنا",
    "من", "علي", "في", "الي", "عن", "مع", "او", "ثم", "حتي", "كل", "اي", "شي", "شيء",
    "يا", "اخوي", "اخي", "اختي", "حبيبي", "استاذ", "السلام", "سلام", "عليكم", "مرحبا", "هلا", "اهلا",
    "شكرا", "مشكور", "الله", "رجاء", "لطفا", "لو سمحت", "تفضل", "ماهو", "ماهي", "عن", "بخصوص",
    "the", "a", "an", "is", "are", "what", "how", "much", "do", "you", "have", "please", "i", "want", "for", "of", "in",
  ].map(normalizeArabic),
);

/** Real-estate synonym groups (normalized). A query word in a group searches the whole group. */
const SYNONYMS: string[][] = [
  ["قسط", "اقساط", "تقسيط", "installment", "installments"],
  ["مقدم", "مقدمه", "عربون", "دفعه اولي", "down payment"],
  ["سعر", "اسعار", "كلفه", "تكلفه", "ثمن", "price", "prices", "cost"],
  ["شقه", "شقق", "apartment", "flat"],
  ["بيت", "بيوت", "منزل", "فيلا", "فلل", "فله", "villa", "house"],
  ["تسليم", "استلام", "جاهز", "delivery", "handover"],
  ["موقع", "عنوان", "مكان", "location", "address"],
  ["مساحه", "متر", "م2", "area", "sqm"],
  ["غرفه", "غرف", "نوم", "bedroom", "bedrooms", "rooms"],
  ["موقف", "مواقف", "كراج", "باركنج", "parking", "garage"],
  ["مسبح", "حوض سباحه", "pool"],
  ["خطه دفع", "طريقه دفع", "دفع", "payment"],
];

const PREFIXES = ["وال", "بال", "فال", "كال", "لل", "ال"];

function stem(word: string): string {
  for (const p of PREFIXES) {
    if (word.startsWith(p) && word.length - p.length >= 3) return word.slice(p.length);
  }
  return word;
}

export type Concept = string[]; // alternative spellings; matching any one counts the concept once

/** Turn a customer question into search concepts (pure; exported for tests). */
export function queryConcepts(question: string, max = 8): Concept[] {
  const words = normalizeArabic(question)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const concepts: Concept[] = [];
  const seen = new Set<string>();
  for (const raw of words) {
    if (STOPWORDS.has(raw)) continue;
    const w = stem(raw);
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    // exact spelling in a group wins; a prefix match ("تقسي…") is only the fallback
    const group =
      SYNONYMS.find((g) => g.some((s) => s === w || s === raw)) ??
      SYNONYMS.find((g) => g.some((s) => w.length >= 3 && !s.includes(" ") && s.startsWith(w)));
    const concept = group ?? [w];
    const key = concept[0];
    if (seen.has(key)) continue;
    seen.add(key);
    concepts.push(concept);
    if (concepts.length >= max) break;
  }
  return concepts;
}

/** Rank candidate chunks by concept coverage (pure; exported for tests). */
export function rankChunks<T extends { content: string; projectId?: string | null }>(
  docs: T[],
  concepts: Concept[],
  projectId?: string | null,
): (T & { score: number })[] {
  return docs
    .map((d) => {
      const text = normalizeArabic(d.content);
      let score = 0;
      for (const c of concepts) {
        const hits = c.reduce((n, alt) => n + (text.split(alt).length - 1), 0);
        if (hits > 0) score += 1 + Math.min(hits - 1, 3) * 0.1;
      }
      if (score > 0 && projectId && d.projectId === projectId) score += 0.5;
      return { ...d, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score);
}

function likePattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function searchKnowledge(
  organizationId: string,
  query: string,
  projectId?: string | null,
  limit = 4,
): Promise<KnowledgeChunk[]> {
  const concepts = queryConcepts(query);
  if (concepts.length === 0) return [];
  const patterns = [...new Set(concepts.flat())].map(likePattern);

  type Row = { content: string; sourceId: string; sourceTitle: string; projectId: string | null };
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT d.content, s.id AS "sourceId", s.title AS "sourceTitle", s."projectId" AS "projectId"
       FROM knowledge_documents d
       JOIN knowledge_sources s ON s.id = d."sourceId"
      WHERE s."organizationId" = $1
        AND s.status = 'ACTIVE'
        AND ($2::text IS NULL OR s."projectId" = $2 OR s."projectId" IS NULL)
        AND ${NORMALIZE_SQL("d.content")} LIKE ANY($3::text[])
      LIMIT 80`,
    organizationId,
    projectId ?? null,
    patterns,
  )) as Row[];

  return rankChunks(rows, concepts, projectId)
    .slice(0, limit)
    .map((r) => ({ content: r.content.slice(0, 1200), sourceTitle: r.sourceTitle, sourceId: r.sourceId }));
}

/**
 * Chunker (~800 chars, sentence-aware). Text without sentence breaks — common
 * in PDFs — is hard-split at the nearest space so no chunk grows unbounded.
 */
export function chunkText(text: string, size = 800): string[] {
  const pieces: string[] = [];
  for (const sentence of text.split(/(?<=[.!؟?\n])\s+/)) {
    let s = sentence;
    while (s.length > size) {
      const cut = s.lastIndexOf(" ", size);
      const at = cut > size * 0.5 ? cut : size;
      pieces.push(s.slice(0, at));
      s = s.slice(at).trimStart();
    }
    if (s) pieces.push(s);
  }

  const chunks: string[] = [];
  let current = "";
  for (const p of pieces) {
    if (current && (current + " " + p).length > size) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + p;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
