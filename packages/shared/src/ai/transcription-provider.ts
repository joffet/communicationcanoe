import type { TranscriptionProvider } from "./types";

// Gated on OPENAI_API_KEY specifically, independent of AI_PROVIDER/
// ANTHROPIC_API_KEY - same asymmetry as createEmbeddingProvider(): Anthropic
// has no transcription endpoint either, so there's no provider choice to
// make, only configured-vs-not.
export function createTranscriptionProvider(): TranscriptionProvider {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAiTranscriptionProvider(process.env.OPENAI_API_KEY);
  }

  console.warn(
    "[transcription-provider] OPENAI_API_KEY not set - using StubTranscriptionProvider. " +
      "Voicemails will be marked ready with placeholder text instead of a real transcript."
  );
  return new StubTranscriptionProvider();
}

class StubTranscriptionProvider implements TranscriptionProvider {
  async transcribe(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    return "[stub transcription - OPENAI_API_KEY not configured]";
  }
}

class OpenAiTranscriptionProvider implements TranscriptionProvider {
  constructor(private apiKey: string) {}

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const extension = mimeType === "audio/mpeg" ? "mp3" : "wav";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), `recording.${extension}`);
    form.append("model", "gpt-4o-mini-transcribe");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!response.ok) {
      throw new Error(`OpenAI transcription error: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as { text?: string };
    return json.text?.trim() ?? "";
  }
}
