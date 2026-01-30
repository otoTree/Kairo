export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AICompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AIUsage {
  input: number;
  output: number;
  total: number;
}

export interface AIChatResponse {
  content: string;
  usage?: AIUsage;
}

export interface AIProvider {
  name: string;
  chat(messages: AIMessage[], options?: AICompletionOptions): Promise<AIChatResponse>;
}
