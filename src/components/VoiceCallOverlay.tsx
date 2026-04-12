import { useSettingsStore } from '../stores/settingsStore';
import type { VoiceCallPhase } from '../hooks/useVoiceCall';

interface VoiceCallOverlayProps {
  phase: VoiceCallPhase;
  subtitle: string;
  pttHeld: boolean;
  inputMode: 'vad' | 'ptt';
  onPttDown: () => void;
  onPttUp: () => void;
  onEnd: () => void;
}

const phaseLabel: Record<VoiceCallPhase, string> = {
  idle: 'Waiting...',
  listening: 'Listening...',
  processing: 'Thinking...',
  speaking: '',
};

export function VoiceCallOverlay({
  phase,
  subtitle,
  pttHeld,
  inputMode,
  onPttDown,
  onPttUp,
  onEnd,
}: VoiceCallOverlayProps) {
  const { voiceCall } = useSettingsStore();

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col">
      {/* Status area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
        {/* Phase indicator ring */}
        <div
          className={`w-32 h-32 rounded-full border-4 flex items-center justify-center transition-all duration-300 ${
            phase === 'listening'
              ? 'border-green-400 shadow-[0_0_30px_rgba(74,222,128,0.3)]'
              : phase === 'processing'
                ? 'border-amber-400 animate-pulse'
                : phase === 'speaking'
                  ? 'border-blue-400 shadow-[0_0_30px_rgba(96,165,250,0.3)]'
                  : 'border-slate-700'
          }`}
        >
          <span className="text-3xl">
            {phase === 'listening'
              ? '🎙'
              : phase === 'processing'
                ? '💭'
                : phase === 'speaking'
                  ? '🔊'
                  : '⏳'}
          </span>
        </div>

        {/* Phase label */}
        {(phase !== 'speaking' || !subtitle) && (
          <p className="text-sm text-slate-400">{phaseLabel[phase]}</p>
        )}

        {/* Subtitle */}
        {subtitle && (
          <div className="max-w-md w-full max-h-40 overflow-y-auto">
            <p className="text-center text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
              {subtitle}
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-6 flex flex-col items-center gap-4 pb-safe">
        {inputMode === 'ptt' && (
          <button
            onPointerDown={onPttDown}
            onPointerUp={onPttUp}
            onPointerLeave={onPttUp}
            className={`w-20 h-20 rounded-full transition-all duration-150 select-none touch-none ${
              pttHeld
                ? 'bg-green-500 scale-110 shadow-[0_0_20px_rgba(74,222,128,0.4)]'
                : 'bg-slate-800 hover:bg-slate-700 active:bg-green-500'
            }`}
          >
            <span className="text-2xl">🎤</span>
          </button>
        )}

        {inputMode === 'vad' && (
          <p className="text-xs text-slate-500">
            VAD mode — sensitivity {voiceCall.vadSensitivity}%
          </p>
        )}

        <button
          onClick={onEnd}
          className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 transition-colors flex items-center justify-center"
        >
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
        <p className="text-xs text-slate-500">End call</p>
      </div>
    </div>
  );
}
