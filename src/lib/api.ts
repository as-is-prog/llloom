import type { AppSettings, Message, Preset } from '../types';

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

interface ChatRequestOptions {
  settings: LlmSettings;
  preset: Preset;
  systemPrompt: string;
  messages: Pick<Message, 'role' | 'content'>[];
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

function buildOllamaBody(options: ChatRequestOptions) {
  const { preset, systemPrompt, messages } = options;
  return {
    model: preset.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
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

function buildOpenAIBody(options: ChatRequestOptions) {
  const { preset, systemPrompt, messages } = options;
  return {
    model: preset.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
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
