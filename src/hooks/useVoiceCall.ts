import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../lib/db';
import { generateId } from '../lib/utils';
import { streamChat } from '../lib/api';
import { synthesize, extractQuotedSegments, createQuoteParserState, TtsQueue } from '../lib/tts';
import { transcribe } from '../lib/stt';
import { useSettingsStore } from '../stores/settingsStore';
import type { Message, Preset } from '../types';

export type VoiceCallPhase = 'idle' | 'listening' | 'processing' | 'speaking';

const MAX_TTS_SYNTH_CONCURRENCY = 2;
/** VADで「無音」と判定するまでのミリ秒 */
const VAD_SILENCE_DURATION_MS = 600;

interface UseVoiceCallOptions {
  roomId: string;
  convId: string;
  systemPrompt: string;
  preset: Preset;
}

export function useVoiceCall({ roomId, convId, systemPrompt, preset }: UseVoiceCallOptions) {
  const settings = useSettingsStore();
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoiceCallPhase>('idle');
  const [subtitle, setSubtitle] = useState('');
  const [pttHeld, setPttHeld] = useState(false);

  // Refs for long-lived mutable state
  const ttsQueueRef = useRef(new TtsQueue());
  const ttsAbortRef = useRef<AbortController | null>(null);
  const llmAbortRef = useRef<AbortController | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const vadSilenceStartRef = useRef<number | null>(null);
  /** TTS合成に送ったセグメントテキストを順番に保持（barge-in時に再生済み分のみ保存するため） */
  const ttsSegmentsRef = useRef<string[]>([]);
  /** ストリーミング中のLLM全文 */
  const llmFullContentRef = useRef('');
  const activeRef = useRef(false);
  /** refで保持して循環依存を断ち切る */
  const handleSilenceTriggerRef = useRef<() => void>(() => {});

  // --- Silence timer ---
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    const thresholdMs = settings.voiceCall.silenceThreshold * 1000;
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null;
      if (activeRef.current) handleSilenceTriggerRef.current();
    }, thresholdMs);
  }, [settings.voiceCall.silenceThreshold, clearSilenceTimer]);

  // --- LLM + TTS pipeline (shared between user utterance and silence trigger) ---
  const runLlmTtsPipeline = useCallback(
    async (extraMessages: Pick<Message, 'role' | 'content'>[], saveUserMsg: boolean) => {
      clearSilenceTimer();
      setPhase('processing');
      setSubtitle('');

      // Cleanup previous TTS
      if (ttsAbortRef.current) ttsAbortRef.current.abort();
      ttsQueueRef.current.clear();
      ttsSegmentsRef.current = [];
      llmFullContentRef.current = '';

      const allMessages = await db.messages
        .where('conversationId')
        .equals(convId)
        .sortBy('createdAt');

      const history = [
        ...allMessages.map((m) => ({ role: m.role, content: m.content })),
        ...extraMessages,
      ];

      // Save user message to DB if needed
      if (saveUserMsg && extraMessages.length > 0) {
        const userMsg: Message = {
          id: generateId(),
          conversationId: convId,
          role: 'user',
          content: extraMessages[0].content,
          createdAt: Date.now(),
        };
        await db.messages.add(userMsg);
        await db.conversations.update(convId, { updatedAt: Date.now() });
        await db.rooms.update(roomId, { updatedAt: Date.now() });
      }

      // Setup TTS
      ttsQueueRef.current.warm();
      const ttsAbort = new AbortController();
      ttsAbortRef.current = ttsAbort;
      const ttsEnabled = settings.tts.enabled && settings.tts.endpointUrl && (settings.tts.engine === 'voicevox' || settings.tts.modelName);
      const quoteState = createQuoteParserState();
      let ttsChain = Promise.resolve();
      const inFlightTts = new Set<Promise<ArrayBuffer>>();

      const runLimitedTtsSynthesis = async (task: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> => {
        while (inFlightTts.size >= MAX_TTS_SYNTH_CONCURRENCY) {
          await Promise.race(inFlightTts).catch(() => undefined);
        }
        const run = Promise.resolve().then(task);
        inFlightTts.add(run);
        run.finally(() => inFlightTts.delete(run));
        return run;
      };

      const scheduleTtsSegment = (seg: string) => {
        ttsSegmentsRef.current.push(seg);
        const audioPromise = runLimitedTtsSynthesis(() =>
          synthesize(settings.tts, seg, ttsAbort.signal),
        );
        ttsChain = ttsChain.then(async () => {
          try {
            const buf = await audioPromise;
            ttsQueueRef.current.enqueue(buf);
          } catch (e: unknown) {
            if (!ttsAbort.signal.aborted) console.warn('TTS:', e);
          }
        });
      };

      // Setup TTS queue callbacks
      ttsQueueRef.current.onAllPlayed = () => {
        if (activeRef.current) {
          setPhase('idle');
          startSilenceTimer();
        }
      };

      const llmAbort = new AbortController();
      llmAbortRef.current = llmAbort;

      setPhase('speaking');

      await streamChat({
        settings: { endpointUrl: settings.endpointUrl, apiType: settings.apiType },
        preset,
        systemPrompt,
        messages: history,
        onChunk: (chunk) => {
          llmFullContentRef.current += chunk;
          setSubtitle(llmFullContentRef.current);

          if (ttsEnabled) {
            const segments = extractQuotedSegments(llmFullContentRef.current, quoteState);
            for (const seg of segments) scheduleTtsSegment(seg);
          }
        },
        onDone: async () => {
          if (ttsEnabled) {
            const remaining = extractQuotedSegments(llmFullContentRef.current, quoteState, true);
            for (const seg of remaining) scheduleTtsSegment(seg);
          }

          // Save assistant message (full content for now; barge-in truncates later)
          const content = llmFullContentRef.current;
          if (content) {
            const assistantMsg: Message = {
              id: generateId(),
              conversationId: convId,
              role: 'assistant',
              content,
              createdAt: Date.now(),
            };
            await db.messages.add(assistantMsg);
            await db.conversations.update(convId, { updatedAt: Date.now() });
          }

          // TTSが無い場合やセグメントが無い場合はここでidleへ
          if (!ttsEnabled || ttsSegmentsRef.current.length === 0) {
            setPhase('idle');
            if (activeRef.current) startSilenceTimer();
          }
        },
        onError: (error) => {
          console.error('Voice call LLM error:', error);
          ttsAbort.abort();
          ttsQueueRef.current.clear();
          setPhase('idle');
          if (activeRef.current) startSilenceTimer();
        },
        signal: llmAbort.signal,
      });
    },
    [convId, roomId, settings, preset, systemPrompt, clearSilenceTimer, startSilenceTimer],
  );

  // --- Barge-in: stop TTS, save only played segments ---
  const bargeIn = useCallback(async () => {
    clearSilenceTimer();

    // Abort LLM stream if still running
    if (llmAbortRef.current) {
      llmAbortRef.current.abort();
      llmAbortRef.current = null;
    }

    const playedCount = ttsQueueRef.current.playedCount;
    const allSegments = ttsSegmentsRef.current;

    // Stop TTS
    if (ttsAbortRef.current) ttsAbortRef.current.abort();
    ttsQueueRef.current.clear();

    // Update the last assistant message to only include played content
    if (allSegments.length > 0 && playedCount < allSegments.length) {
      const lastMsg = await db.messages
        .where('conversationId')
        .equals(convId)
        .last();

      if (lastMsg?.role === 'assistant') {
        if (playedCount === 0) {
          // Nothing was played — delete the message entirely
          await db.messages.delete(lastMsg.id);
        } else {
          // Reconstruct content from played segments only
          const playedText = allSegments.slice(0, playedCount).join('');
          // Replace the quoted speech in the original content
          const fullContent = lastMsg.content;
          // Find where the played segments end in the full text and truncate
          let truncated = fullContent;
          const lastPlayedSeg = allSegments[playedCount - 1];
          const lastPlayedIdx = fullContent.indexOf(lastPlayedSeg);
          if (lastPlayedIdx !== -1) {
            truncated = fullContent.slice(0, lastPlayedIdx + lastPlayedSeg.length);
            // Try to close any open quote
            if (truncated.includes('「') && !truncated.endsWith('」')) {
              truncated += '……」';
            }
          } else {
            // Fallback: just use played segments joined
            truncated = '「' + playedText + '……」';
          }
          await db.messages.update(lastMsg.id, { content: truncated });
        }
      }
    }

    ttsSegmentsRef.current = [];
    llmFullContentRef.current = '';
  }, [convId, clearSilenceTimer]);

  // --- Handle silence trigger (AI self-initiation) ---
  const handleSilenceTrigger = useCallback(() => {
    const threshold = settings.voiceCall.silenceThreshold;
    const ephemeralMsg = { role: 'user' as const, content: `(ユーザーが${threshold}秒沈黙しています)` };
    // saveUserMsg=false: don't persist the silence prompt
    runLlmTtsPipeline([ephemeralMsg], false);
  }, [settings.voiceCall.silenceThreshold, runLlmTtsPipeline]);

  // refを常に最新に保つ（startSilenceTimerとの循環依存を回避）
  handleSilenceTriggerRef.current = handleSilenceTrigger;

  // --- Recording ---
  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob());
        return;
      }
      recorder.ondataavailable = (e) => resolve(e.data);
      recorder.stop();
      isRecordingRef.current = false;
    });
  }, []);

  const processRecording = useCallback(
    async (audioBlob: Blob) => {
      if (audioBlob.size === 0) {
        setPhase('idle');
        startSilenceTimer();
        return;
      }

      // Barge-in: stop any ongoing TTS/LLM
      const wasPlaying = ttsQueueRef.current.isPlaying || phase === 'speaking';
      if (wasPlaying) await bargeIn();

      setPhase('processing');
      try {
        const text = await transcribe(settings.voiceCall.sttEndpointUrl, audioBlob);
        if (!text) {
          setPhase('idle');
          startSilenceTimer();
          return;
        }
        await runLlmTtsPipeline([{ role: 'user', content: text }], true);
      } catch (e) {
        console.error('STT error:', e);
        setPhase('idle');
        startSilenceTimer();
      }
    },
    [settings.voiceCall.sttEndpointUrl, phase, bargeIn, runLlmTtsPipeline, startSilenceTimer],
  );

  const startRecording = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream || isRecordingRef.current) return;

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorderRef.current = recorder;
    recorder.start();
    isRecordingRef.current = true;
    setPhase('listening');
    clearSilenceTimer();
  }, [clearSilenceTimer]);

  // --- VAD loop ---
  const startVadLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.fftSize);
    const sensitivity = settings.voiceCall.vadSensitivity / 100; // 0-1

    const check = () => {
      if (!activeRef.current) return;

      analyser.getByteTimeDomainData(dataArray);
      // RMS計算
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const isSpeaking = rms > (1 - sensitivity) * 0.15;

      if (isSpeaking) {
        vadSilenceStartRef.current = null;
        if (!isRecordingRef.current) {
          startRecording();
        }
      } else if (isRecordingRef.current) {
        if (vadSilenceStartRef.current === null) {
          vadSilenceStartRef.current = Date.now();
        } else if (Date.now() - vadSilenceStartRef.current > VAD_SILENCE_DURATION_MS) {
          vadSilenceStartRef.current = null;
          stopRecording().then(processRecording);
        }
      }

      vadFrameRef.current = requestAnimationFrame(check);
    };

    vadFrameRef.current = requestAnimationFrame(check);
  }, [settings.voiceCall.vadSensitivity, startRecording, stopRecording, processRecording]);

  // --- PTT handlers ---
  const pttDown = useCallback(() => {
    if (!active) return;
    setPttHeld(true);
    startRecording();
  }, [active, startRecording]);

  const pttUp = useCallback(() => {
    if (!active) return;
    setPttHeld(false);
    stopRecording().then(processRecording);
  }, [active, stopRecording, processRecording]);

  // --- Start / Stop voice call ---
  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      activeRef.current = true;
      setActive(true);
      setPhase('idle');

      if (settings.voiceCall.inputMode === 'vad') {
        startVadLoop();
      }

      // TTS warm (user gesture context)
      ttsQueueRef.current.warm();

      startSilenceTimer();
    } catch (e) {
      console.error('Microphone access denied:', e);
    }
  }, [settings.voiceCall.inputMode, startVadLoop, startSilenceTimer]);

  const stop = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    setPhase('idle');
    clearSilenceTimer();

    if (vadFrameRef.current !== null) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }

    if (ttsAbortRef.current) ttsAbortRef.current.abort();
    ttsQueueRef.current.clear();
    ttsQueueRef.current.onAllPlayed = null;

    if (llmAbortRef.current) {
      llmAbortRef.current.abort();
      llmAbortRef.current = null;
    }

    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    isRecordingRef.current = false;

    setSubtitle('');
  }, [clearSilenceTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeRef.current) stop();
    };
  }, [stop]);

  return { active, phase, subtitle, pttHeld, start, stop, pttDown, pttUp };
}
