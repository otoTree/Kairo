import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import type { AIProvider, AIMessage, AICompletionOptions, AIChatResponse, AIEmbeddingOptions, AIEmbeddingResponse } from "./types";

export class AIPlugin implements Plugin {
  readonly name = "ai";
  private providers: Map<string, AIProvider> = new Map();
  private defaultProviderName?: string;

  constructor(providers: AIProvider[] = [], defaultProvider?: string) {
    providers.forEach(p => this.registerProvider(p));
    this.defaultProviderName = defaultProvider || providers[0]?.name;
  }

  registerProvider(provider: AIProvider) {
    this.providers.set(provider.name, provider);
    if (!this.defaultProviderName) {
      this.defaultProviderName = provider.name;
    }
  }

  getProvider(name?: string): AIProvider {
    const providerName = name || this.defaultProviderName;
    if (!providerName) {
      throw new Error("No AI providers registered.");
    }
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`AI Provider ${providerName} not found.`);
    }
    return provider;
  }

  async chat(messages: AIMessage[], options?: AICompletionOptions & { provider?: string }): Promise<AIChatResponse> {
    const provider = this.getProvider(options?.provider);
    return provider.chat(messages, options);
  }

  async embed(text: string, options?: AIEmbeddingOptions & { provider?: string }): Promise<AIEmbeddingResponse> {
    const provider = this.getProvider(options?.provider);
    return provider.embed(text, options);
  }

  setup(app: Application) {
    console.log("[AI] Setting up AI domain...");
    // Register the plugin instance itself as a service so other plugins can use it
    app.registerService("ai", this);
  }

  start() {
    console.log(`[AI] AI domain active. Default provider: ${this.defaultProviderName}`);
  }
}
