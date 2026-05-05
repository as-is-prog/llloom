export interface AppSettings {
  endpointUrl: string;
  apiType: 'ollama' | 'openai' | 'lmstudio';
  apiToken: string;
  lmStudioIntegrations: string;
  tts: TtsSettings;
  voiceCall: VoiceCallSettings;
}

export interface VoiceCallSettings {
  sttEndpointUrl: string;
  inputMode: 'vad' | 'ptt';
  silenceThreshold: number; // seconds before AI self-initiates
  vadSensitivity: number; // 0-100, volume threshold for VAD
  vadSilenceDuration: number; // ms, silence duration to end recording
  /** Default ON/OFF state for the call-mode camera toggle. User can flip mid-call. */
  cameraDefaultOn: boolean;
}

export interface TtsSettings {
  enabled: boolean;
  engine: 'sbv2' | 'voicevox';
  endpointUrl: string;
  /** SBV2: model name */
  modelName: string;
  /** SBV2: style name */
  style: string;
  /** SBV2: style weight */
  styleWeight: number;
  speed: number;
  /** VoiceVox: speaker ID */
  speakerId: number;
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
