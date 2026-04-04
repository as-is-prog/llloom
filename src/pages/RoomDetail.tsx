import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { generateId, formatDate } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import type { Conversation } from '../types';

export function RoomDetail() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const room = useLiveQuery(() => db.rooms.get(roomId!), [roomId]);
  const conversations = useLiveQuery(
    () => db.conversations.where('roomId').equals(roomId!).reverse().sortBy('updatedAt'),
    [roomId],
  );
  const preset = useLiveQuery(
    () => (room?.presetId ? db.presets.get(room.presetId) : undefined),
    [room?.presetId],
  );

  const createConversation = async () => {
    if (!roomId) return;
    const now = Date.now();
    const conv: Conversation = {
      id: generateId(),
      roomId,
      title: 'New Chat',
      createdAt: now,
      updatedAt: now,
    };
    await db.conversations.add(conv);
    await db.rooms.update(roomId, { updatedAt: now });
    navigate(`/rooms/${roomId}/chat/${conv.id}`);
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await db.messages.where('conversationId').equals(convId).delete();
    await db.conversations.delete(convId);
  };

  if (!room) {
    return (
      <div className="flex items-center justify-center min-h-dvh text-slate-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh">
      <PageHeader
        title={room.name}
        backTo="/"
        right={
          <button
            onClick={() => navigate(`/rooms/${roomId}/edit`)}
            className="p-1 text-slate-400 hover:text-slate-200"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        }
      />

      <div className="px-4 py-3 border-b border-slate-800">
        <p className="text-xs text-slate-500 line-clamp-3">{room.systemPrompt}</p>
        {preset && (
          <p className="text-xs text-slate-600 mt-1">
            Preset: {preset.name} / {preset.model}
          </p>
        )}
      </div>

      <div className="flex-1 p-4 space-y-2">
        {conversations?.map((conv) => (
          <button
            key={conv.id}
            onClick={() => navigate(`/rooms/${roomId}/chat/${conv.id}`)}
            className="w-full text-left p-3 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors flex items-center"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{conv.title}</div>
              <div className="text-xs text-slate-500">{formatDate(conv.updatedAt)}</div>
            </div>
            <button
              onClick={(e) => deleteConversation(conv.id, e)}
              className="ml-2 p-1 text-slate-600 hover:text-red-400 shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </button>
        ))}

        {conversations?.length === 0 && (
          <div className="text-center text-slate-500 py-12">
            <p>会話がまだありません</p>
          </div>
        )}
      </div>

      <div className="p-4">
        <button
          onClick={createConversation}
          className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
        >
          + New Chat
        </button>
      </div>
    </div>
  );
}
