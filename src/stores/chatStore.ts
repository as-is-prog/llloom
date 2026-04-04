import { create } from 'zustand';

interface ChatStore {
  streamingContent: string;
  isStreaming: boolean;
  abortController: AbortController | null;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  startStreaming: () => AbortController;
  stopStreaming: () => void;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  streamingContent: '',
  isStreaming: false,
  abortController: null,
  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),
  startStreaming: () => {
    const controller = new AbortController();
    set({ isStreaming: true, streamingContent: '', abortController: controller });
    return controller;
  },
  stopStreaming: () => {
    const { abortController } = get();
    abortController?.abort();
    set({ isStreaming: false, abortController: null });
  },
}));
