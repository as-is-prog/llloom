import type { AppSettings, Message, Preset } from '../types';
import type { EphemeralImage } from './image';

type LlmSettings = Pick<AppSettings, 'endpointUrl' | 'apiType'>;

export async function fetchModels(settings: LlmSettings): Promise<string[]> {
  const url =
    settings.apiType === 'ollama'
      ? `${settings.endpointUrl}/api/tags`
      : `${settings.endpointUrl}/v1/models`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const json = await res.json();

  if (settings.apiType === 'ollama') {
    return (json.models ?? []).map((m: { name: string }) => m.name);
  }
  return (json.data ?? []).map((m: { id: string }) => m.id);
}

/**
 * Query Ollama `/api/show` for a model's capabilities.
 * Returns null when capabilities can't be determined (older Ollama, network error, etc.),
 * so callers should treat null as "unknown" rather than "no vision".
 */
export async function fetchOllamaCapabilities(
  settings: LlmSettings,
  model: string,
): Promise<string[] | null> {
  if (settings.apiType !== 'ollama' || !model) return null;
  try {
    const res = await fetch(`${settings.endpointUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (Array.isArray(json.capabilities)) return json.capabilities as string[];
    return null;
  } catch {
    return null;
  }
}

interface ChatRequestOptions {
  settings: LlmSettings;
  preset: Preset;
  systemPrompt: string;
  messages: Pick<Message, 'role' | 'content'>[];
  /**
   * Ephemeral images attached to the last user message only.
   * Not persisted anywhere — caller supplies them per-turn.
   */
  ephemeralImages?: EphemeralImage[];
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

/** Index of the last user-role message, or -1 if none. */
function findLastUserIndex(messages: Pick<Message, 'role' | 'content'>[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

function buildOllamaBody(options: ChatRequestOptions) {
  const { preset, systemPrompt, messages, ephemeralImages } = options;
  const lastUserIdx = ephemeralImages?.length ? findLastUserIndex(messages) : -1;

  const chatMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map((m, idx) => {
      const base: { role: string; content: string; images?: string[] } = {
        role: m.role,
        content: m.content,
      };
      if (idx === lastUserIdx && ephemeralImages?.length) {
        base.images = ephemeralImages.map((img) => img.base64);
      }
      return base;
    }),
  ];

  return {
    model: preset.model,
    messages: chatMessages,
    stream: true,
    options: {
      temperature: preset.temperature,
      top_p: preset.topP,
      num_predict: preset.maxTokens,
      frequency_penalty: preset.frequencyPenalty,
      presence_penalty: preset.presencePenalty,
    },
  };
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function buildOpenAIBody(options: ChatRequestOptions) {
  const { preset, systemPrompt, messages, ephemeralImages } = options;
  const lastUserIdx = ephemeralImages?.length ? findLastUserIndex(messages) : -1;

  const chatMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map((m, idx) => {
      if (idx === lastUserIdx && ephemeralImages?.length) {
        const parts: OpenAIContentPart[] = [{ type: 'text', text: m.content }];
        for (const img of ephemeralImages) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
          });
        }
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: m.content };
    }),
  ];

  return {
    model: preset.model,
    messages: chatMessages,
    stream: true,
    temperature: preset.temperature,
    top_p: preset.topP,
    max_tokens: preset.maxTokens,
    frequency_penalty: preset.frequencyPenalty,
    presence_penalty: preset.presencePenalty,
  };
}

async function parseOllamaStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines[lines.length - 1] || '';
    const completeLines = lines.slice(0, -1);
    for (const line of completeLines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          onChunk(json.message.content);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  if (buffer.trim()) {
    try {
      const json = JSON.parse(buffer);
      if (json.message?.content) onChunk(json.message.content);
    } catch {
      // ignore malformed trailing buffer
    }
  }
}

async function parseOpenAIStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const content = json.choices?.[0]?.delta?.content;
        if (content) onChunk(content);
      } catch {
        // skip
      }
    }
  }
}

export async function streamChat(options: ChatRequestOptions) {
  const { settings, onChunk, onDone, onError, signal } = options;

  const isOllama = settings.apiType === 'ollama';
  const url = isOllama
    ? `${settings.endpointUrl}/api/chat`
    : `${settings.endpointUrl}/v1/chat/completions`;

  const body = isOllama ? buildOllamaBody(options) : buildOpenAIBody(options);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    if (isOllama) {
      await parseOllamaStream(reader, onChunk, signal);
    } else {
      await parseOpenAIStream(reader, onChunk, signal);
    }

    onDone();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      onDone();
      return;
    }
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English, ~2 for CJK
  const cjkChars = (text.match(/[\u3000-\u9fff\uf900-\ufaff]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(otherChars / 4 + cjkChars / 2);
}
