import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { generateId } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import type { Room } from '../types';

const DEFAULT_PRESET_ID = 'default';

export function RoomList() {
  const navigate = useNavigate();
  const rooms = useLiveQuery(() => db.rooms.orderBy('updatedAt').reverse().toArray());

  const createRoom = async () => {
    // Ensure default preset exists
    const existing = await db.presets.get(DEFAULT_PRESET_ID);
    if (!existing) {
      await db.presets.add({
        id: DEFAULT_PRESET_ID,
        name: 'Default',
        model: 'llama3',
        temperature: 0.2,
        topP: 0.9,
        maxTokens: 2048,
        frequencyPenalty: 1.1,
        presencePenalty: 0,
        contextLength: 65535,
      });
    }

    const now = Date.now();
    const room: Room = {
      id: generateId(),
      name: 'New Room',
      systemPrompt: 'You are a helpful assistant.',
      presetId: DEFAULT_PRESET_ID,
      createdAt: now,
      updatedAt: now,
    };
    await db.rooms.add(room);
    navigate(`/rooms/${room.id}/edit`);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <PageHeader
        title="llloom"
        right={
          <button
            onClick={() => navigate('/settings')}
            className="p-1 text-slate-400 hover:text-slate-200"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        }
      />

      <div className="flex-1 p-4 space-y-3">
        {rooms?.map((room) => (
          <button
            key={room.id}
            onClick={() => navigate(`/rooms/${room.id}`)}
            className="w-full text-left p-4 bg-slate-900 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors"
          >
            <div className="font-medium">{room.name}</div>
            <div className="text-sm text-slate-400 mt-1 line-clamp-2">
              {room.systemPrompt}
            </div>
          </button>
        ))}

        {rooms?.length === 0 && (
          <div className="text-center text-slate-500 py-12">
            <p>Roomがまだありません</p>
          </div>
        )}
      </div>

      <div className="p-4">
        <button
          onClick={createRoom}
          className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
        >
          + New Room
        </button>
      </div>
    </div>
  );
}
