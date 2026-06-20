import type { AiCompletionRequest, AiProvider } from "./types";

type ProviderName = "openai" | "anthropic";

export function createAiProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER ?? "openai") as ProviderName;

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
  }

  if (process.env.OPENAI_API_KEY) {
    return new OpenAiProvider(process.env.OPENAI_API_KEY);
  }

  return new StubProvider();
}

class StubProvider implements AiProvider {
  async complete(request: AiCompletionRequest): Promise<string> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return `[stub] ${lastUser?.content.slice(0, 120) ?? "no input"}`;
  }
}

class OpenAiProvider implements AiProvider {
  constructor(private apiKey: string) {}

  async complete(request: AiCompletionRequest): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: request.maxTokens ?? 512,
        messages: [
          { role: "system", content: request.system },
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }
}

class AnthropicProvider implements AiProvider {
  constructor(private apiKey: string) {}

  async complete(request: AiCompletionRequest): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-latest",
        max_tokens: request.maxTokens ?? 512,
        system: request.system,
        messages: request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic error: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  }
}
