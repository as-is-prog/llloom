import type { TtsSettings } from '../types';

export async function synthesize(
  settings: TtsSettings,
  text: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    text,
    model_name: settings.modelName,
    language: 'JP',
    style: settings.style,
    style_weight: String(settings.styleWeight),
    length: String(settings.speed),
  });

  const res = await fetch(`${settings.endpointUrl}/voice?${params}`, {
    method: 'POST',
    headers: { 'X-Request-Source': 'llloom' },
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TTS error: ${res.status} ${body}`);
  }
  return res.arrayBuffer();
}

/**
 * ストリーミングテキストから新しい「」ペアを検出し、中身を返す。
 * processedUpTo: 前回までに処理済みのインデックス位置。
 * 戻り値: [抽出されたテキスト配列, 新しいprocessedUpTo]
 */
export function extractQuotedSegments(
  text: string,
  processedUpTo: number,
): [string[], number] {
  const segments: string[] = [];
  let pos = processedUpTo;

  while (pos < text.length) {
    const openIdx = text.indexOf('「', pos);
    if (openIdx === -1) break;

    const closeIdx = text.indexOf('」', openIdx + 1);
    if (closeIdx === -1) break; // まだ閉じてない → 次のchunkを待つ

    const inner = text.slice(openIdx + 1, closeIdx).trim();
    if (inner) segments.push(inner);
    pos = closeIdx + 1;
  }

  return [segments, pos];
}

export class TtsQueue {
  private queue: ArrayBuffer[] = [];
  private playing = false;
  private ctx: AudioContext | null = null;
  private aborted = false;
  private currentSource: AudioBufferSourceNode | null = null;

  enqueue(audio: ArrayBuffer) {
    this.queue.push(audio);
    if (!this.playing) this.playNext();
  }

  clear() {
    this.queue = [];
    this.aborted = true;
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* already stopped */ }
      this.currentSource = null;
    }
    this.playing = false;
  }

  private async playNext() {
    if (this.queue.length === 0) {
      this.playing = false;
      return;
    }

    this.playing = true;
    this.aborted = false;
    const buf = this.queue.shift()!;

    try {
      if (!this.ctx) this.ctx = new AudioContext();
      const audioBuf = await this.ctx.decodeAudioData(buf.slice(0));
      if (this.aborted) return;

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(this.ctx.destination);
      this.currentSource = source;

      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    } catch (e) {
      console.warn('TTS playback error:', e);
    }

    this.currentSource = null;
    if (!this.aborted) this.playNext();
  }
}
