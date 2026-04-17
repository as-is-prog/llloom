import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import type { VoiceCallPhase } from '../hooks/useVoiceCall';

interface VoiceCallOverlayProps {
  phase: VoiceCallPhase;
  subtitle: string;
  pttHeld: boolean;
  inputMode: 'vad' | 'ptt';
  cameraActive: boolean;
  cameraStream: MediaStream | null;
  onPttDown: () => void;
  onPttUp: () => void;
  onEnd: () => void;
  onToggleCamera: () => void;
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
  cameraActive,
  cameraStream,
  onPttDown,
  onPttUp,
  onEnd,
  onToggleCamera,
}: VoiceCallOverlayProps) {
  const { voiceCall } = useSettingsStore();
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = previewRef.current;
    if (!video) return;
    if (video.srcObject !== cameraStream) {
      video.srcObject = cameraStream;
    }
    if (cameraStream) {
      video.play().catch(() => undefined);
    }
  }, [cameraStream]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col">
      {/* Camera preview (top-right corner) */}
      {cameraActive && cameraStream && (
        <div className="absolute top-4 right-4 w-40 aspect-[4/3] rounded-lg overflow-hidden border border-slate-700 shadow-lg bg-black">
          <video
            ref={previewRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      )}

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

        <div className="flex items-center gap-4">
          <button
            onClick={onToggleCamera}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              cameraActive
                ? 'bg-blue-600 hover:bg-blue-500'
                : 'bg-slate-800 hover:bg-slate-700'
            }`}
            title={cameraActive ? 'カメラOFF' : 'カメラON'}
          >
            {cameraActive ? (
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l18 18a.75.75 0 1 0 1.06-1.06l-18-18ZM22.676 12.553a11.249 11.249 0 0 1-2.631 4.31l-3.099-3.099a5.25 5.25 0 0 0-6.71-6.71L7.759 4.577a11.217 11.217 0 0 1 4.242-.827c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 12c0 .18-.013.357-.037.53l-4.244-4.243A3.75 3.75 0 0 1 15.75 12ZM12.53 15.713l-4.243-4.244a3.75 3.75 0 0 0 4.244 4.243Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12c0-.619.107-1.213.304-1.764l-3.1-3.1a11.25 11.25 0 0 0-2.63 4.31c-.12.362-.12.752 0 1.114 1.489 4.467 5.704 7.69 10.675 7.69 1.5 0 2.933-.294 4.242-.827l-2.477-2.477A5.25 5.25 0 0 1 6.75 12Z" />
              </svg>
            )}
          </button>

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
        </div>
        <p className="text-xs text-slate-500">End call</p>
      </div>
    </div>
  );
}
