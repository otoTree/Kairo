
import type { AIProvider, AIMessage, AICompletionOptions, AIChatResponse } from "../types";

export interface OpenAIOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(options: OpenAIOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    this.defaultModel = options.defaultModel || process.env.OPENAI_MODEL_NAME || "gpt-3.5-turbo";
  }

  configure(options: OpenAIOptions) {
    if (options.apiKey !== undefined) this.apiKey = options.apiKey;
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
    if (options.defaultModel !== undefined) this.defaultModel = options.defaultModel;
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
