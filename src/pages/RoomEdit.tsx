import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { PageHeader } from '../components/PageHeader';
import type { Preset, Room } from '../types';

export function RoomEdit() {
  const { roomId } = useParams<{ roomId: string }>();

  const room = useLiveQuery(() => db.rooms.get(roomId!), [roomId]);
  const presets = useLiveQuery(() => db.presets.toArray());

  if (!room || !roomId) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-500">
        Loading...
      </div>
    );
  }

  return <RoomEditForm key={room.id} roomId={roomId} room={room} presets={presets ?? []} />;
}

function RoomEditForm({
  roomId,
  room,
  presets,
}: {
  roomId: string;
  room: Room;
  presets: Preset[];
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(room.name);
  const [systemPrompt, setSystemPrompt] = useState(room.systemPrompt);
  const [presetId, setPresetId] = useState(room.presetId);

  const save = async () => {
    await db.rooms.update(roomId, {
      name: name.trim() || 'Untitled',
      systemPrompt,
      presetId,
      updatedAt: Date.now(),
    });
    navigate(`/rooms/${roomId}`);
  };

  const deleteRoom = async () => {
    const convs = await db.conversations.where('roomId').equals(roomId).toArray();
    for (const conv of convs) {
      await db.messages.where('conversationId').equals(conv.id).delete();
    }
    await db.conversations.where('roomId').equals(roomId).delete();
    await db.rooms.delete(roomId);
    navigate('/');
  };

  return (
    <div className="flex flex-col min-h-screen">
      <PageHeader
        title="Edit Room"
        backTo={`/rooms/${roomId}`}
        right={
          <button onClick={save} className="text-sm text-blue-400 hover:text-blue-300 font-medium">
            Save
          </button>
        }
      />

      <div className="flex-1 p-4 space-y-5">
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">Room Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1.5">System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600 resize-y"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1.5">Preset</label>
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.model})
              </option>
            ))}
          </select>
        </div>

        <div className="pt-4 border-t border-slate-800">
          <button
            onClick={deleteRoom}
            className="w-full py-2.5 rounded-lg bg-red-950 border border-red-900 text-red-400 hover:bg-red-900 text-sm transition-colors"
          >
            Delete Room
          </button>
        </div>
      </div>
    </div>
  );
}
