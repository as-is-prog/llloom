export interface AppSettings {
  endpointUrl: string;
  apiType: 'ollama' | 'openai';
  tts: TtsSettings;
}

export interface TtsSettings {
  enabled: boolean;
  endpointUrl: string;
  modelName: string;
  style: string;
  styleWeight: number;
  speed: number;
}

export interface Preset {
  id: string;
  name: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  frequencyPenalty: number;
  presencePenalty: number;
  contextLength: number;
}

export interface Room {
  id: string;
  name: string;
  systemPrompt: string;
  presetId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  roomId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  tokenCount?: number;
}
