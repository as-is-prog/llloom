import Dexie, { type EntityTable } from 'dexie';
import type { Preset, Room, Conversation, Message } from '../types';

const db = new Dexie('llloom') as Dexie & {
  presets: EntityTable<Preset, 'id'>;
  rooms: EntityTable<Room, 'id'>;
  conversations: EntityTable<Conversation, 'id'>;
  messages: EntityTable<Message, 'id'>;
};

db.version(2).stores({
  presets: 'id, name',
  rooms: 'id, name, updatedAt, presetId',
  conversations: 'id, roomId, updatedAt',
  messages: 'id, conversationId, createdAt',
});

export { db };
