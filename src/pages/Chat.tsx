import { useEffect, useRef, useCallback, useMemo } from 'react';
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
import type { Message } from '../types';

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

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const ttsQueueRef = useRef(new TtsQueue());

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
    async () => {
      if (!room || !preset || !convId) return;

      const allMessages = await db.messages
        .where('conversationId')
        .equals(convId)
        .sortBy('createdAt');

      const controller = startStreaming();

      let fullContent = '';
      const ttsEnabled = settings.tts.enabled && settings.tts.endpointUrl && settings.tts.modelName;
      const ttsAbort = new AbortController();
      const quoteState = createQuoteParserState();

      await streamChat({
        settings: { endpointUrl: settings.endpointUrl, apiType: settings.apiType },
        preset,
        systemPrompt: room.systemPrompt,
        messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        onChunk: (chunk) => {
          fullContent += chunk;
          appendStreamingContent(chunk);

          if (ttsEnabled) {
            const segments = extractQuotedSegments(fullContent, quoteState);
            for (const seg of segments) {
              synthesize(settings.tts, seg, ttsAbort.signal)
                .then((buf) => ttsQueueRef.current.enqueue(buf))
                .catch((e) => { if (e.name !== 'AbortError') console.warn('TTS:', e); });
            }
          }
        },
        onDone: async () => {
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
    [room, preset, convId, settings, startStreaming, appendStreamingContent, setStreamingContent, stopStreaming],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!room || !preset || !convId) return;

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

      await requestAIResponse();
    },
    [room, preset, convId, requestAIResponse],
  );

  /** Edit a user message: update content, delete all messages after it, then re-request AI */
  const handleEdit = useCallback(
    async (messageId: string, newContent: string) => {
      if (!convId || isStreaming) return;

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
    [convId, isStreaming, requestAIResponse],
  );

  /** Regenerate: delete the last assistant message and re-request */
  const handleRegenerate = useCallback(
    async () => {
      if (!convId || isStreaming || !messages) return;

      // Find the last assistant message
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          await db.messages.delete(messages[i].id);
          break;
        }
      }

      await requestAIResponse();
    },
    [convId, isStreaming, messages, requestAIResponse],
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
          isStreaming ? (
            <button
              onClick={() => { ttsQueueRef.current.clear(); stopStreaming(); }}
              className="text-xs text-red-400 hover:text-red-300 font-medium"
            >
              Stop
            </button>
          ) : null
        }
      />

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
