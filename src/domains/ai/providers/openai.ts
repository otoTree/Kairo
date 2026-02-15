
import type { AIProvider, AIMessage, AICompletionOptions, AIChatResponse, AIEmbeddingOptions, AIEmbeddingResponse, AIUsage } from "../types";

export interface OpenAIOptions {
  name?: string; // Allow overriding the provider name
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  defaultEmbeddingModel?: string;
}

export class OpenAIProvider implements AIProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private defaultEmbeddingModel: string;

  constructor(options: OpenAIOptions = {}) {
    this.name = options.name || "openai";
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    this.defaultModel = options.defaultModel || process.env.OPENAI_MODEL_NAME || "gpt-3.5-turbo";
    this.defaultEmbeddingModel = options.defaultEmbeddingModel || process.env.OPENAI_EMBEDDING_MODEL_NAME || "text-embedding-3-small";
  }

  configure(options: OpenAIOptions) {
    // Note: name cannot be reconfigured as it is readonly
    if (options.apiKey !== undefined) this.apiKey = options.apiKey;
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
    if (options.defaultModel !== undefined) this.defaultModel = options.defaultModel;
    if (options.defaultEmbeddingModel !== undefined) this.defaultEmbeddingModel = options.defaultEmbeddingModel;
  }

  async embed(text: string, options?: AIEmbeddingOptions): Promise<AIEmbeddingResponse> {
    const model = options?.model || this.defaultEmbeddingModel;

    try {
        const url = `${this.baseUrl.replace(/\/$/, "")}/embeddings`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model,
                input: text,
                dimensions: options?.dimensions,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
        }

        const data = await response.json() as {
            data: { embedding: number[] }[];
            usage: { prompt_tokens: number; total_tokens: number };
        };

        const embedding = data.data?.[0]?.embedding;
        if (!embedding) {
            throw new Error("OpenAI API returned no embedding data");
        }

        const usage: AIUsage | undefined = data.usage ? {
            input: data.usage.prompt_tokens,
            output: 0,
            total: data.usage.total_tokens
        } : undefined;

        return {
            embedding,
            usage
        };
    } catch (error) {
        console.error("[OpenAI] Embedding error:", error);
        throw error;
    }
  }

  async chat(messages: AIMessage[], options?: AICompletionOptions): Promise<AIChatResponse> {
    const model = options?.model || this.defaultModel;
    
    try {
      // Ensure baseUrl doesn't end with slash if we're appending /chat/completions
      // But usually baseUrl is provided as "https://api.openai.com/v1"
      const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false, // Explicitly disable stream as current interface doesn't support it
          temperature: options?.temperature,
          max_tokens: options?.maxTokens,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as {
        choices: { message: { content: string } }[];
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };

      const firstChoice = data.choices[0];
      if (!firstChoice) {
        throw new Error("OpenAI API returned no choices");
      }

      let usage: { input: number; output: number; total: number } | undefined;
      if (data.usage) {
        usage = {
          input: data.usage.prompt_tokens,
          output: data.usage.completion_tokens,
          total: data.usage.total_tokens
        };
      }

      return {
        content: firstChoice.message.content,
        usage
      };
    } catch (error) {
      console.error("[OpenAI] Chat error:", error);
      throw error;
    }
  }
}
