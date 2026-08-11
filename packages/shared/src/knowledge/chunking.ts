// Hand-rolled, paragraph-aware chunker for RAG document ingestion. No
// tokenizer dependency - chunk sizes are character-based approximations
// (~4 chars/token is a reasonable rule of thumb for English prose).
//
// Pure and deterministic: same (text, config) always produces the same
// chunks, so the ingestion worker's re-chunk path can always be a plain
// delete-then-reinsert, never an incremental diff.

export interface ChunkConfig {
  targetChunkChars: number;
  maxChunkChars: number;
  overlapChars: number;
  minChunkChars: number;
}

export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  targetChunkChars: 3000, // ~750 tokens
  maxChunkChars: 4000, // ~1000 tokens
  overlapChars: 200,
  minChunkChars: 200,
};

export interface DocumentChunk {
  chunkIndex: number;
  heading: string | null;
  content: string;
}

const HEADING_MAX_LENGTH = 100;

// A line under HEADING_MAX_LENGTH chars that doesn't end in sentence
// punctuation reads as a heading/title line often enough to be a useful,
// cheap heuristic (e.g. "Article III, Section 4.2: Parking Rules",
// markdown "## Parking Rules") - not perfect, but chunking quality here is
// judged empirically via the fixture-based retrieval eval, not by this
// heuristic being exactly right.
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > HEADING_MAX_LENGTH) return false;
  if (trimmed.startsWith("#")) return true;
  return !/[.!?]$/.test(trimmed);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function chunkDocumentText(text: string, config: ChunkConfig = DEFAULT_CHUNK_CONFIG): DocumentChunk[] {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return [];

  type RawChunk = { heading: string | null; parts: string[]; length: number };
  const rawChunks: RawChunk[] = [];
  let currentHeading: string | null = null;
  let current: RawChunk = { heading: currentHeading, parts: [], length: 0 };

  const flushCurrent = () => {
    if (current.parts.length > 0) rawChunks.push(current);
    current = { heading: currentHeading, parts: [], length: 0 };
  };

  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n");
    if (lines.length === 1 && isHeadingLine(lines[0])) {
      currentHeading = lines[0].trim().replace(/^#+\s*/, "");
      // Only stamp the heading onto `current` if it hasn't accumulated any
      // content yet - otherwise a heading encountered mid-accumulation would
      // retroactively relabel content that belongs to the *previous* heading.
      if (current.parts.length === 0) {
        current.heading = currentHeading;
      }
      continue;
    }

    if (current.length > 0 && current.length + paragraph.length > config.targetChunkChars) {
      flushCurrent();
      // Carry a small tail of the previous chunk forward for context continuity.
      const prev = rawChunks[rawChunks.length - 1];
      const overlapText = prev.parts.join("\n\n").slice(-config.overlapChars);
      if (overlapText) {
        current.parts.push(overlapText);
        current.length += overlapText.length;
      }
    }

    current.parts.push(paragraph);
    current.length += paragraph.length;

    // A single paragraph longer than maxChunkChars still becomes its own
    // chunk (no mid-paragraph splitting) - flush immediately rather than
    // letting more content accumulate on top of an already-oversized chunk.
    if (current.length >= config.maxChunkChars) {
      flushCurrent();
    }
  }
  flushCurrent();

  // Merge sub-minimum trailing chunks into their neighbor - a final chunk of
  // a few words embeds close to noise in cosine space and behaves
  // unpredictably in retrieval.
  const merged: RawChunk[] = [];
  for (const chunk of rawChunks) {
    if (chunk.length < config.minChunkChars && merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.parts.push(...chunk.parts);
      prev.length += chunk.length;
    } else {
      merged.push(chunk);
    }
  }
  // A too-short first chunk has no earlier neighbor to merge into - fold it
  // forward into the second chunk instead, if one exists.
  if (merged.length > 1 && merged[0].length < config.minChunkChars) {
    const [first, second] = merged;
    second.parts = [...first.parts, ...second.parts];
    second.length += first.length;
    second.heading = second.heading ?? first.heading;
    merged.shift();
  }

  return merged.map((chunk, chunkIndex) => ({
    chunkIndex,
    heading: chunk.heading,
    content: chunk.parts.join("\n\n"),
  }));
}
