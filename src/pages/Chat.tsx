import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useVirtualizer } from '@tanstack/react-virtual';
import { db } from '../lib/db';
import { generateId } from '../lib/utils';
import { streamChat, estimateTokens } from '../lib/api';
import { useSettingsStore } from '../stores/settingsStore';
import { useChatStore } from '../stores/chatStore';
import { PageHeader } from '../components/PageHeader';
import { ChatInput } from '../components/ChatInput';
import { MessageBubble } from '../components/MessageBubble';
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

  // Items = messages + optional streaming message
  const items = useMemo(() => {
    const list: { id: string; role: Message['role']; content: string }[] =
      messages?.map((m) => ({ id: m.id, role: m.role, content: m.content })) ?? [];
    if (isStreaming && streamingContent) {
      list.push({ id: '__streaming__', role: 'assistant', content: streamingContent });
    }
    return list;
  }, [messages, isStreaming, streamingContent]);

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

      const allMessages = await db.messages
        .where('conversationId')
        .equals(convId)
        .sortBy('createdAt');

      const controller = startStreaming();

      let fullContent = '';
      await streamChat({
        settings: { endpointUrl: settings.endpointUrl, apiType: settings.apiType },
        preset,
        systemPrompt: room.systemPrompt,
        messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        onChunk: (chunk) => {
          fullContent += chunk;
          appendStreamingContent(chunk);
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
          setStreamingContent('');
          stopStreaming();
        },
        signal: controller.signal,
      });
    },
    [room, preset, convId, settings, startStreaming, appendStreamingContent, setStreamingContent, stopStreaming],
  );

  if (!room || !conversation) {
    return (
      <div className="flex items-center justify-center min-h-dvh text-slate-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh">
      <PageHeader
        title={conversation.title}
        backTo={`/rooms/${roomId}`}
        right={
          isStreaming ? (
            <button
              onClick={stopStreaming}
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
                <MessageBubble role={item.role} content={item.content} />
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
