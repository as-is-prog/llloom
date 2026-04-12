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
      tts: {
        enabled: false,
        engine: 'sbv2',
        endpointUrl: '',
        modelName: '',
        style: 'Neutral',
        styleWeight: 1,
        speed: 1.0,
        speakerId: 0,
      },
      voiceCall: {
        sttEndpointUrl: 'http://localhost:8000',
        inputMode: 'vad',
        silenceThreshold: 10,
        vadSensitivity: 30,
      },
      update: (settings) => set(settings),
    }),
    { name: 'llloom-settings' },
  ),
);
