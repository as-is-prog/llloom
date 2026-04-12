import type { TtsSettings } from '../types';

const MAX_TTS_RETRIES = 2;
const TTS_RETRY_BASE_MS = 500;
/** 1回のリクエストがこの時間を超えたらタイムアウト扱いにする */
const TTS_REQUEST_TIMEOUT_MS = 30_000;

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

  for (let attempt = 0; ; attempt++) {
    // リクエスト単位のタイムアウト＋呼び出し元のabortを合成
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), TTS_REQUEST_TIMEOUT_MS);
    const forwardAbort = () => ac.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) ac.abort();

    try {
      const res = await fetch(`${settings.endpointUrl}/voice?${params}`, {
        method: 'POST',
        headers: { 'X-Request-Source': 'llloom' },
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`TTS error: ${res.status} ${body}`);
      }
      return await res.arrayBuffer();
    } catch (e) {
      if (signal?.aborted) throw e;
      if (attempt >= MAX_TTS_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, TTS_RETRY_BASE_MS * (attempt + 1)));
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
}

// 句読点で分割するが、直後に閉じ括弧が続く場合は分割しない
// 例: 「（豚バラ、イカなど！）をたっぷり」→「！」では分割しない
const SENTENCE_DELIMITERS = /(?<=[。！？!?])(?![）\)」】》〉』])/;

/**
 * ストリーミングテキストから「」内の発話を文単位で抽出する。
 *
 * - 「」が閉じるたびに中身を「。」等で分割して返す
 * - 「」が閉じる前でも、既に確定した文（。で終わる部分）は先行して返す
 *
 * state: { processedUpTo: 閉じた「」の処理位置, pendingOpen: 開いたまま未処理の「の位置, sentenceCursor: 未確定文の開始位置 }
 */
export interface QuoteParserState {
  processedUpTo: number;
  pendingOpen: number;
  sentenceCursor: number;
}

export function createQuoteParserState(): QuoteParserState {
  return { processedUpTo: 0, pendingOpen: -1, sentenceCursor: 0 };
}

export function extractQuotedSegments(
  text: string,
  state: QuoteParserState,
  flush = false,
): string[] {
  const segments: string[] = [];

  // 1) 開き「を探す（まだ開いてない場合）
  if (state.pendingOpen === -1) {
    const openIdx = text.indexOf('「', state.processedUpTo);
    if (openIdx === -1) return segments;
    state.pendingOpen = openIdx;
    state.sentenceCursor = openIdx + 1;
  }

  // 2) 開いた「」の中を処理
  const closeIdx = text.indexOf('」', state.sentenceCursor);

  if (closeIdx === -1) {
    // まだ閉じてない → 確定した文（。等で終わる部分）を先行抽出
    const inner = text.slice(state.sentenceCursor);
    const sentences = inner.split(SENTENCE_DELIMITERS);
    // flush=false: 最後の要素は未確定なので残す
    // flush=true:  ストリーム終了時は全て出す
    const limit = flush ? sentences.length : sentences.length - 1;
    for (let i = 0; i < limit; i++) {
      const s = sentences[i].trim();
      if (s) segments.push(s);
      state.sentenceCursor += sentences[i].length;
    }
  } else {
    // 閉じた → 残りの中身を全部分割して出す
    const inner = text.slice(state.sentenceCursor, closeIdx);
    const sentences = inner.split(SENTENCE_DELIMITERS);
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (s) segments.push(s);
    }
    state.processedUpTo = closeIdx + 1;
    state.pendingOpen = -1;
    state.sentenceCursor = closeIdx + 1;

    // 同じテキスト内に次の「」があるかもしれないので再帰
    segments.push(...extractQuotedSegments(text, state));
  }

  return segments;
}

export class TtsQueue {
  private queue: ArrayBuffer[] = [];
  private playing = false;
  private ctx: AudioContext | null = null;
  /** clear() のたびにインクリメント。旧 playNext が残存しても世代違いで自動退出する */
  private generation = 0;
  private currentSource: AudioBufferSourceNode | null = null;
  private _playedCount = 0;
  /** 各セグメント再生完了時に呼ばれる */
  onSegmentPlayed: (() => void) | null = null;
  /** キュー内の全セグメント再生完了時に呼ばれる */
  onAllPlayed: (() => void) | null = null;

  get playedCount() { return this._playedCount; }
  get isPlaying() { return this.playing; }

  /**
   * ユーザー操作（タップ/クリック）のコンテキスト内で呼ぶ。
   * iOS Safari は操作起点でないと AudioContext が suspended のまま再生できない。
   */
  warm() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  enqueue(audio: ArrayBuffer) {
    this.queue.push(audio);
    if (!this.playing) this.playNext();
  }

  clear() {
    this.queue = [];
    this.generation++;
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* already stopped */ }
      this.currentSource = null;
    }
    this.playing = false;
    this._playedCount = 0;
  }

  private async playNext() {
    if (this.queue.length === 0) {
      this.playing = false;
      return;
    }

    this.playing = true;
    const gen = this.generation;
    const buf = this.queue.shift()!;

    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const audioBuf = await this.ctx.decodeAudioData(buf.slice(0));
      if (this.generation !== gen) return;

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(this.ctx.destination);
      this.currentSource = source;

      await new Promise<void>((resolve) => {
        // onended が発火しない場合に備えた安全タイムアウト
        const safetyMs = (audioBuf.duration + 2) * 1000;
        const timer = setTimeout(() => resolve(), safetyMs);
        source.onended = () => {
          clearTimeout(timer);
          resolve();
        };
        source.start();
      });
    } catch (e) {
      console.warn('TTS playback error:', e);
    }

    this.currentSource = null;
    if (this.generation === gen) {
      this._playedCount++;
      this.onSegmentPlayed?.();
      if (this.queue.length === 0) {
        this.playing = false;
        this.onAllPlayed?.();
      } else {
        this.playNext();
      }
    }
  }
}
