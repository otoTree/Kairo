import type { AIProvider, AIMessage, AICompletionOptions, AIChatResponse } from "../types";

export interface OllamaOptions {
  baseUrl?: string;
  defaultModel?: string;
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private defaultModel: string;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = options.baseUrl || "http://localhost:11434";
    this.defaultModel = options.defaultModel || "qwen3:0.6b";
  }

  async chat(messages: AIMessage[], options?: AICompletionOptions): Promise<AIChatResponse> {
    const model = options?.model || this.defaultModel;
    
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: options?.temperature,
            num_predict: options?.maxTokens,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as { 
        message: { content: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      return {
        content: data.message.content,
        usage: {
          input: data.prompt_eval_count || 0,
          output: data.eval_count || 0,
          total: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        }
      };
    } catch (error) {
      console.error("[Ollama] Chat error:", error);
      throw error;
    }
  }
}
