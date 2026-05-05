import type { AppSettings, Message, Preset } from '../types';
import type { EphemeralImage } from './image';

type LlmSettings = Pick<AppSettings, 'endpointUrl' | 'apiType' | 'apiToken' | 'lmStudioIntegrations'>;

function buildHeaders(settings: LlmSettings): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = settings.apiToken.trim();
  if (token && settings.apiType !== 'ollama') {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function assertApiTokenIfRequired(settings: LlmSettings) {
  if (settings.apiType === 'lmstudio' && !settings.apiToken.trim()) {
    throw new Error('LM Studio API token is required. Set it in Settings > API Token.');
  }
}

async function getErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const json = JSON.parse(text);
      return json.error?.message || json.message || text;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function fetchModels(settings: LlmSettings): Promise<string[]> {
  assertApiTokenIfRequired(settings);

  const url =
    settings.apiType === 'ollama'
      ? `${settings.endpointUrl}/api/tags`
      : settings.apiType === 'lmstudio'
        ? `${settings.endpointUrl}/api/v1/models`
      : `${settings.endpointUrl}/v1/models`;

  const res = await fetch(url, { headers: buildHeaders(settings) });
  if (!res.ok) throw new Error(`Failed to fetch models: ${await getErrorMessage(res)}`);
  const json = await res.json();

  if (settings.apiType === 'ollama') {
    return (json.models ?? []).map((m: { name: string }) => m.name);
  }
  if (settings.apiType === 'lmstudio') {
    return (json.models ?? [])
      .filter((m: { type?: string }) => m.type !== 'embedding')
      .map((m: { key: string }) => m.key);
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

function buildLmStudioBody(options: ChatRequestOptions) {
  const { preset, systemPrompt, messages, ephemeralImages } = options;
  const lastUserIdx = ephemeralImages?.length ? findLastUserIndex(messages) : -1;
  const integrations = options.settings.lmStudioIntegrations
    .split(',')
    .map((integration) => integration.trim())
    .filter(Boolean);
  const transcript = messages
    .map((m, idx) => {
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
      const imageNote = idx === lastUserIdx && ephemeralImages?.length
        ? `\n[${ephemeralImages.length} image(s) attached]`
        : '';
      return `${role}: ${m.content}${imageNote}`;
    })
    .join('\n\n');

  const input: Array<{ type: 'message'; content: string } | { type: 'image'; data_url: string }> = [
    { type: 'message', content: transcript },
  ];
  if (lastUserIdx >= 0 && ephemeralImages?.length) {
    for (const img of ephemeralImages) {
      input.push({
        type: 'image',
        data_url: `data:${img.mimeType};base64,${img.base64}`,
      });
    }
  }

  return {
    model: preset.model,
    input: ephemeralImages?.length ? input : transcript,
    system_prompt: systemPrompt,
    stream: true,
    store: false,
    ...(integrations.length ? { integrations } : {}),
    temperature: clamp(preset.temperature, 0, 1),
    top_p: clamp(preset.topP, 0, 1),
    max_output_tokens: Math.max(1, Math.floor(preset.maxTokens)),
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

async function parseLmStudioStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
) {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';

  const flushEvent = (event: string, dataLines: string[]) => {
    if (!dataLines.length) return;
    let json: {
      type?: string;
      content?: string;
      error?: { message?: string };
    };
    try {
      json = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }
    if ((event === 'message.delta' || json.type === 'message.delta') && json.content) {
      onChunk(json.content);
    }
    if ((event === 'error' || json.type === 'error') && json.error?.message) {
      throw new Error(json.error.message);
    }
  };

  let dataLines: string[] = [];
  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        flushEvent(eventName, dataLines);
        eventName = '';
        dataLines = [];
        continue;
      }
      if (trimmed.startsWith('event:')) {
        eventName = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        dataLines.push(trimmed.slice(5).trimStart());
      }
    }
  }

  if (buffer.trim().startsWith('data:')) {
    dataLines.push(buffer.trim().slice(5).trimStart());
  }
  flushEvent(eventName, dataLines);
}

export async function streamChat(options: ChatRequestOptions) {
  const { settings, onChunk, onDone, onError, signal } = options;

  const isOllama = settings.apiType === 'ollama';
  const isLmStudio = settings.apiType === 'lmstudio';
  const url = isOllama
    ? `${settings.endpointUrl}/api/chat`
    : isLmStudio
      ? `${settings.endpointUrl}/api/v1/chat`
    : `${settings.endpointUrl}/v1/chat/completions`;

  const body = isOllama
    ? buildOllamaBody(options)
    : isLmStudio
      ? buildLmStudioBody(options)
      : buildOpenAIBody(options);

  try {
    assertApiTokenIfRequired(settings);

    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`API error: ${await getErrorMessage(response)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    if (isOllama) {
      await parseOllamaStream(reader, onChunk, signal);
    } else if (isLmStudio) {
      await parseLmStudioStream(reader, onChunk, signal);
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
