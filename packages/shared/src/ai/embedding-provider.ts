import type { EmbeddingProvider } from "./types";

const EMBEDDING_DIMENSIONS = 1536;

// Gated on OPENAI_API_KEY specifically, independent of AI_PROVIDER/
// ANTHROPIC_API_KEY - Anthropic has no embeddings endpoint, so unlike
// createAiProvider() there's no provider choice to make, only configured-vs-not.
export function createEmbeddingProvider(): EmbeddingProvider {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAiEmbeddingProvider(process.env.OPENAI_API_KEY);
  }

  console.warn(
    "[embedding-provider] OPENAI_API_KEY not set - using StubEmbeddingProvider. " +
      "Document ingestion will complete but retrieval will never find relevant chunks."
  );
  return new StubEmbeddingProvider();
}

class StubEmbeddingProvider implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    // Deterministic fake vectors (not random) so ingestion is reproducible
    // in dev/test without a real key. Never meaningfully similar to a real
    // query embedding, so retrieval silently finds nothing - the documented
    // no-op fallback, not an error.
    return texts.map((text) => {
      const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
      for (let i = 0; i < text.length; i++) {
        vector[i % EMBEDDING_DIMENSIONS] += text.charCodeAt(i);
      }
      return vector;
    });
  }
}

class OpenAiEmbeddingProvider implements EmbeddingProvider {
  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings error: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as {
      data?: Array<{ index: number; embedding: number[] }>;
    };

    if (!json.data || json.data.length !== texts.length) {
      throw new Error("OpenAI embeddings error: response length did not match input length");
    }

    return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
