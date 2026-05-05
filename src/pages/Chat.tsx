import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useVirtualizer } from '@tanstack/react-virtual';
import { db } from '../lib/db';
import { generateId } from '../lib/utils';
import { streamChat, estimateTokens } from '../lib/api';
import { synthesize, extractQuotedSegments, createQuoteParserState, TtsQueue } from '../lib/tts';
import { useSettingsStore } from '../stores/settingsStore';
import { useChatStore } from '../stores/chatStore';
import { PageHeader } from '../components/PageHeader';
import { ChatInput } from '../components/ChatInput';
import { MessageBubble, TypingIndicator } from '../components/MessageBubble';
import { ContextMeter } from '../components/ContextMeter';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { VoiceCallOverlay } from '../components/VoiceCallOverlay';
import type { Message } from '../types';
import type { EphemeralImage } from '../lib/image';

const TTS_SYNTH_ERROR_MESSAGE = '音声合成に失敗しました。TTS接続や設定を確認してください。';
const MAX_TTS_SYNTH_CONCURRENCY = 2;

export function Chat() {
  const { roomId, convId } = useParams<{ roomId: string; convId: string }>();
  const settings = useSettingsStore();
  const { streamingContent, isStreaming, appendStreamingContent, startStreaming, stopStreaming, setStreamingContent } =
    useChatStore();

  const room = useLiveQuery(() => db.rooms.get(roomId!), [roomId]);
  const conversation = useLiveQuery(() => db.conversations.get(convId!), [convId]);
  const messages = useLiveQuery(
    () => db.messages.where('conversationId').equals(convId!).sortBy('createdAt'),
    [convId],
  );
  const preset = useLiveQuery(
    () => (room?.presetId ? db.presets.get(room.presetId) : undefined),
    [room?.presetId],
  );

  const voiceCall = useVoiceCall({
    roomId: roomId!,
    convId: convId!,
    systemPrompt: room?.systemPrompt ?? '',
    preset: preset ?? { id: '', name: '', model: '', temperature: 0, topP: 0, maxTokens: 0, frequencyPenalty: 0, presencePenalty: 0, contextLength: 0 },
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const ttsQueueRef = useRef(new TtsQueue());
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsToastTimerRef = useRef<number | null>(null);
  const [ttsToastMessage, setTtsToastMessage] = useState('');

  const showTtsToast = useCallback((message: string) => {
    setTtsToastMessage(message);
    if (ttsToastTimerRef.current !== null) {
      window.clearTimeout(ttsToastTimerRef.current);
    }
    ttsToastTimerRef.current = window.setTimeout(() => {
      setTtsToastMessage('');
      ttsToastTimerRef.current = null;
    }, 4000);
  }, []);

  // Items = messages + optional typing indicator or streaming message
  const items = useMemo(() => {
    const list: { id: string; role: Message['role']; content: string; type: 'message' | 'typing' | 'streaming' }[] =
      messages?.map((m) => ({ id: m.id, role: m.role, content: m.content, type: 'message' as const })) ?? [];
    if (isStreaming && streamingContent) {
      list.push({ id: '__streaming__', role: 'assistant', content: streamingContent, type: 'streaming' });
    } else if (isStreaming && !streamingContent) {
      list.push({ id: '__typing__', role: 'assistant', content: '', type: 'typing' });
    }
    return list;
  }, [messages, isStreaming, streamingContent]);

  // Find last assistant message id (from DB, not streaming)
  const lastAssistantId = useMemo(() => {
    if (!messages) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (shouldAutoScroll.current && items.length > 0) {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    }
  }, [items.length, streamingContent, virtualizer]);

  useEffect(() => {
    return () => {
      if (ttsToastTimerRef.current !== null) {
        window.clearTimeout(ttsToastTimerRef.current);
      }
    };
  }, []);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    shouldAutoScroll.current = atBottom;
  };

  // Token estimation for context meter
  const contextUsed = useMemo(() => {
    let tokens = 0;
    if (room?.systemPrompt) tokens += estimateTokens(room.systemPrompt);
    messages?.forEach((m) => {
      tokens += estimateTokens(m.content);
    });
    if (streamingContent) tokens += estimateTokens(streamingContent);
    return tokens;
  }, [room?.systemPrompt, messages, streamingContent]);

  /** Stream an AI response based on the current messages in the DB */
  const requestAIResponse = useCallback(
    async (ephemeralImages?: EphemeralImage[]) => {
      if (!room || !preset || !convId) return;

      // 前回のTTS状態をクリーンアップ（旧合成の中止＋キュークリア）
      if (ttsAbortRef.current) ttsAbortRef.current.abort();
      ttsQueueRef.current.clear();

      const allMessages = await db.messages
        .where('conversationId')
        .equals(convId)
        .sortBy('createdAt');

      const controller = startStreaming();

      let fullContent = '';
      const ttsEnabled = settings.tts.enabled && settings.tts.endpointUrl && (settings.tts.engine === 'voicevox' || settings.tts.modelName);
      const ttsAbort = new AbortController();
      ttsAbortRef.current = ttsAbort;
      const quoteState = createQuoteParserState();
      // 合成リクエストは並列に発火しつつ、enqueueの順序を保証するチェーン
      let ttsChain = Promise.resolve();
      const inFlightTts = new Set<Promise<ArrayBuffer>>();

      const runLimitedTtsSynthesis = async (task: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> => {
        while (inFlightTts.size >= MAX_TTS_SYNTH_CONCURRENCY) {
          await Promise.race(inFlightTts).catch(() => undefined);
        }
        const run = Promise.resolve().then(task);
        inFlightTts.add(run);
        run.finally(() => {
          inFlightTts.delete(run);
        });
        return run;
      };

      const scheduleTtsSegment = (seg: string) => {
        const audioPromise = runLimitedTtsSynthesis(() => synthesize(settings.tts, seg, ttsAbort.signal));
        ttsChain = ttsChain.then(async () => {
          try {
            const buf = await audioPromise;
            ttsQueueRef.current.enqueue(buf);
          } catch (e: unknown) {
            if (!ttsAbort.signal.aborted) {
              console.warn('TTS:', e);
              showTtsToast(TTS_SYNTH_ERROR_MESSAGE);
            }
          }
        });
      };

      await streamChat({
        settings: {
          endpointUrl: settings.endpointUrl,
          apiType: settings.apiType,
          apiToken: settings.apiToken,
          lmStudioIntegrations: settings.lmStudioIntegrations,
        },
        preset,
        systemPrompt: room.systemPrompt,
        messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        ephemeralImages,
        onChunk: (chunk) => {
          fullContent += chunk;
          appendStreamingContent(chunk);

          if (ttsEnabled) {
            const segments = extractQuotedSegments(fullContent, quoteState);
            for (const seg of segments) {
              scheduleTtsSegment(seg);
            }
          }
        },
        onDone: async () => {
          // ストリーム終了時、未確定テキストをフラッシュしてTTSに送る
          if (ttsEnabled) {
            const remaining = extractQuotedSegments(fullContent, quoteState, true);
            for (const seg of remaining) {
              scheduleTtsSegment(seg);
            }
          }

          if (fullContent) {
            const assistantMsg: Message = {
              id: generateId(),
              conversationId: convId,
              role: 'assistant',
              content: fullContent,
              createdAt: Date.now(),
            };
            await db.messages.add(assistantMsg);
            await db.conversations.update(convId, { updatedAt: Date.now() });
          }
          setStreamingContent('');
          stopStreaming();
        },
        onError: (error) => {
          console.error('Stream error:', error);
          ttsAbort.abort();
          ttsQueueRef.current.clear();
          setStreamingContent('');
          stopStreaming();
        },
        signal: controller.signal,
      });
    },
    [room, preset, convId, settings, startStreaming, appendStreamingContent, setStreamingContent, stopStreaming, showTtsToast],
  );

  const sendMessage = useCallback(
    async (content: string, images?: EphemeralImage[]) => {
      if (!room || !preset || !convId) return;
      if (settings.tts.enabled) ttsQueueRef.current.warm();

      const now = Date.now();
      const userMsg: Message = {
        id: generateId(),
        conversationId: convId,
        role: 'user',
        content,
        createdAt: now,
      };
      await db.messages.add(userMsg);

      // Update conversation title from first message
      const msgCount = await db.messages.where('conversationId').equals(convId).count();
      if (msgCount === 1) {
        const title = content.slice(0, 50) + (content.length > 50 ? '…' : '');
        await db.conversations.update(convId, { title, updatedAt: now });
      }
      await db.rooms.update(room.id, { updatedAt: now });

      await requestAIResponse(images);
    },
    [room, preset, convId, settings.tts.enabled, requestAIResponse],
  );

  /** Edit a user message: update content, delete all messages after it, then re-request AI */
  const handleEdit = useCallback(
    async (messageId: string, newContent: string) => {
      if (!convId || isStreaming) return;
      if (settings.tts.enabled) ttsQueueRef.current.warm();

      const allMessages = await db.messages
        .where('conversationId')
        .equals(convId)
        .sortBy('createdAt');

      const idx = allMessages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      // Update the edited message
      await db.messages.update(messageId, { content: newContent });

      // Delete all messages after the edited one
      const idsToDelete = allMessages.slice(idx + 1).map((m) => m.id);
      if (idsToDelete.length > 0) {
        await db.messages.bulkDelete(idsToDelete);
      }

      await requestAIResponse();
    },
    [convId, isStreaming, settings.tts.enabled, requestAIResponse],
  );

  /** Regenerate: delete the last assistant message and re-request */
  const handleRegenerate = useCallback(
    async () => {
      if (!convId || isStreaming || !messages) return;
      if (settings.tts.enabled) ttsQueueRef.current.warm();

      // Find the last assistant message
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          await db.messages.delete(messages[i].id);
          break;
        }
      }

      await requestAIResponse();
    },
    [convId, isStreaming, messages, settings.tts.enabled, requestAIResponse],
  );

  if (!room || !conversation) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        title={conversation.title}
        backTo={`/rooms/${roomId}`}
        right={
          <div className="flex items-center gap-2">
            {isStreaming && (
              <button
                onClick={() => { if (ttsAbortRef.current) ttsAbortRef.current.abort(); ttsQueueRef.current.clear(); stopStreaming(); }}
                className="text-xs text-red-400 hover:text-red-300 font-medium"
              >
                Stop
              </button>
            )}
            {!isStreaming && !voiceCall.active && settings.tts.enabled && (
              <button
                onClick={voiceCall.start}
                className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-200"
                title="Voice call"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
              </button>
            )}
          </div>
        }
      />

      {voiceCall.active && (
        <VoiceCallOverlay
          phase={voiceCall.phase}
          subtitle={voiceCall.subtitle}
          pttHeld={voiceCall.pttHeld}
          inputMode={settings.voiceCall.inputMode}
          cameraActive={voiceCall.cameraActive}
          cameraStream={voiceCall.cameraStream}
          availableCameras={voiceCall.availableCameras}
          currentCameraId={voiceCall.currentCameraId}
          onPttDown={voiceCall.pttDown}
          onPttUp={voiceCall.pttUp}
          onEnd={voiceCall.stop}
          onToggleCamera={voiceCall.toggleCamera}
          onSwitchCamera={voiceCall.switchCamera}
          onAttachPreviewVideo={voiceCall.attachPreviewVideo}
        />
      )}

      {ttsToastMessage && (
        <div className="fixed top-14 right-4 z-50 px-3 py-2 rounded-lg bg-amber-500/90 text-slate-950 text-xs font-medium shadow-lg">
          {ttsToastMessage}
        </div>
      )}

      {preset && (
        <div className="px-4 py-1.5 border-b border-slate-800">
          <ContextMeter used={contextUsed} max={preset.contextLength} />
        </div>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className="py-1.5"
              >
                {item.type === 'typing' ? (
                  <TypingIndicator />
                ) : (
                  <MessageBubble
                    role={item.role}
                    content={item.content}
                    isLastAssistant={item.id === lastAssistantId}
                    isStreaming={isStreaming}
                    onEdit={item.role === 'user' ? (newContent) => handleEdit(item.id, newContent) : undefined}
                    onRegenerate={handleRegenerate}
                  />
                )}
              </div>
            );
          })}
        </div>

        {items.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            メッセージを送信してください
          </div>
        )}
      </div>

      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
