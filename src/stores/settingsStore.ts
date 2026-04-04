import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings } from '../types';

interface SettingsStore extends AppSettings {
  update: (settings: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      endpointUrl: 'http://localhost:11434',
      apiType: 'ollama',
      update: (settings) => set(settings),
    }),
    { name: 'llloom-settings' },
  ),
);
