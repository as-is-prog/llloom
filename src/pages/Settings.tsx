import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { generateId } from '../lib/utils';
import { useSettingsStore } from '../stores/settingsStore';
import { PageHeader } from '../components/PageHeader';
import type { Preset, TtsSettings, VoiceCallSettings } from '../types';

type Sbv2ModelInfo = {
  spk2id: Record<string, number>;
  style2id: Record<string, number>;
  model_path?: string;
};

export function Settings() {
  const navigate = useNavigate();
  const { endpointUrl, apiType, apiToken, lmStudioIntegrations, tts, voiceCall, update } = useSettingsStore();
  const presets = useLiveQuery(() => db.presets.toArray());
  const [ttsModels, setTtsModels] = useState<{ name: string; styles: string[] }[]>([]);
  const [vvSpeakers, setVvSpeakers] = useState<{ name: string; styles: { name: string; id: number }[] }[]>([]);
  const [ttsStatus, setTtsStatus] = useState<string>('');

  const updateTts = (partial: Partial<TtsSettings>) => update({ tts: { ...tts, ...partial } });
  const updateVoiceCall = (partial: Partial<VoiceCallSettings>) => update({ voiceCall: { ...voiceCall, ...partial } });

  const fetchTtsModels = async () => {
    if (!tts.endpointUrl) return;
    setTtsStatus('Loading...');
    try {
      if (tts.engine === 'voicevox') {
        const { fetchVoiceVoxSpeakers } = await import('../lib/tts');
        const speakers = await fetchVoiceVoxSpeakers(tts.endpointUrl);
        setVvSpeakers(speakers);
        setTtsModels([]);
        setTtsStatus(`${speakers.length} speaker(s) found`);
      } else {
        const res = await fetch(`${tts.endpointUrl}/models/info`);
        if (!res.ok) throw new Error(`${res.status}`);
        const info = await res.json() as Record<string, Sbv2ModelInfo>;
        const models = Object.values(info).map((m) => ({
          name: Object.keys(m.spk2id)[0] ?? m.model_path,
          styles: Object.keys(m.style2id),
        }));
        setTtsModels(models);
        setVvSpeakers([]);
        setTtsStatus(`${models.length} model(s) found`);
      }
    } catch (e) {
      setTtsStatus(`Error: ${e}`);
      setTtsModels([]);
      setVvSpeakers([]);
    }
  };

  const selectedModelStyles = ttsModels.find((m) => m.name === tts.modelName)?.styles ?? [];

  const createPreset = async () => {
    const preset: Preset = {
      id: generateId(),
      name: 'New Preset',
      model: 'llama3',
      temperature: 0.2,
      topP: 0.9,
      maxTokens: 2048,
      frequencyPenalty: 1.1,
      presencePenalty: 0,
      contextLength: 65535,
    };
    await db.presets.add(preset);
    navigate(`/settings/presets/${preset.id}`);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <PageHeader title="Settings" backTo="/" />

      <div className="flex-1 p-4 space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-400">Endpoint</h2>

          <div>
            <label className="block text-xs text-slate-500 mb-1">API Type</label>
            <select
              value={apiType}
              onChange={(e) => update({ apiType: e.target.value as 'ollama' | 'openai' | 'lmstudio' })}
              className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
            >
              <option value="ollama">Ollama</option>
              <option value="lmstudio">LM Studio API</option>
              <option value="openai">OpenAI Compatible (LM Studio etc.)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Endpoint URL</label>
            <input
              value={endpointUrl}
              onChange={(e) => update({ endpointUrl: e.target.value })}
              placeholder={apiType === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'}
              className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
            />
          </div>

          {apiType !== 'ollama' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">API Token</label>
              <input
                type="password"
                value={apiToken}
                onChange={(e) => update({ apiToken: e.target.value })}
                placeholder="LM Studio API token"
                autoComplete="off"
                className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
              />
            </div>
          )}

          {apiType === 'lmstudio' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">LM Studio Integrations</label>
              <input
                value={lmStudioIntegrations}
                onChange={(e) => update({ lmStudioIntegrations: e.target.value })}
                placeholder="mcp/playwright, mcp/example"
                autoComplete="off"
                className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
              />
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-400">TTS</h2>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tts.enabled}
              onChange={(e) => updateTts({ enabled: e.target.checked })}
              className="rounded bg-slate-900 border-slate-700"
            />
            <span className="text-sm">Enable TTS</span>
          </label>

          {tts.enabled && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Engine</label>
                <select
                  value={tts.engine}
                  onChange={(e) => {
                    updateTts({ engine: e.target.value as 'sbv2' | 'voicevox' });
                    setTtsModels([]);
                    setVvSpeakers([]);
                    setTtsStatus('');
                  }}
                  className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
                >
                  <option value="sbv2">Style-Bert-VITS2</option>
                  <option value="voicevox">VoiceVox</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Endpoint URL</label>
                <div className="flex gap-2">
                  <input
                    value={tts.endpointUrl}
                    onChange={(e) => updateTts({ endpointUrl: e.target.value })}
                    placeholder={tts.engine === 'voicevox' ? 'http://localhost:50021' : 'https://example.ts.net/other-api/sbv2'}
                    className="flex-1 bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
                  />
                  <button
                    onClick={fetchTtsModels}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors shrink-0"
                  >
                    Fetch
                  </button>
                </div>
                {ttsStatus && <p className="text-xs text-slate-500 mt-1">{ttsStatus}</p>}
              </div>

              {tts.engine === 'sbv2' && (
                <>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Model</label>
                    {ttsModels.length > 0 ? (
                      <select
                        value={tts.modelName}
                        onChange={(e) => updateTts({ modelName: e.target.value, style: 'Neutral' })}
                        className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
                      >
                        <option value="">-- select --</option>
                        {ttsModels.map((m) => (
                          <option key={m.name} value={m.name}>{m.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={tts.modelName}
                        onChange={(e) => updateTts({ modelName: e.target.value })}
                        placeholder="Model name"
                        className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
                      />
                    )}
                  </div>

                  {selectedModelStyles.length > 0 && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Style</label>
                      <select
                        value={tts.style}
                        onChange={(e) => updateTts({ style: e.target.value })}
                        className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
                      >
                        {selectedModelStyles.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      Style Weight: {tts.styleWeight}
                    </label>
                    <input
                      type="range"
                      min={0} max={20} step={1}
                      value={tts.styleWeight}
                      onChange={(e) => updateTts({ styleWeight: Number(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                </>
              )}

              {tts.engine === 'voicevox' && vvSpeakers.length > 0 && (
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Speaker</label>
                  <select
                    value={tts.speakerId}
                    onChange={(e) => updateTts({ speakerId: Number(e.target.value) })}
                    className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
                  >
                    {vvSpeakers.map((sp) =>
                      sp.styles.map((st) => (
                        <option key={st.id} value={st.id}>
                          {sp.name} - {st.name}
                        </option>
                      )),
                    )}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Speed: {tts.speed}
                </label>
                <input
                  type="range"
                  min={0.5} max={2.0} step={0.1}
                  value={tts.speed}
                  onChange={(e) => updateTts({ speed: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-400">Voice Call (STT)</h2>

          <div>
            <label className="block text-xs text-slate-500 mb-1">STT Endpoint URL</label>
            <input
              value={voiceCall.sttEndpointUrl}
              onChange={(e) => updateVoiceCall({ sttEndpointUrl: e.target.value })}
              placeholder="http://localhost:8000"
              className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Input Mode</label>
            <select
              value={voiceCall.inputMode}
              onChange={(e) => updateVoiceCall({ inputMode: e.target.value as 'vad' | 'ptt' })}
              className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
            >
              <option value="vad">VAD (Voice Activity Detection)</option>
              <option value="ptt">PTT (Push to Talk)</option>
            </select>
          </div>

          {voiceCall.inputMode === 'vad' && (
            <>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  VAD Sensitivity: {voiceCall.vadSensitivity}%
                </label>
                <input
                  type="range"
                  min={5} max={80} step={5}
                  value={voiceCall.vadSensitivity}
                  onChange={(e) => updateVoiceCall({ vadSensitivity: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Silence Duration: {voiceCall.vadSilenceDuration ?? 1200}ms
                </label>
                <input
                  type="range"
                  min={400} max={3000} step={100}
                  value={voiceCall.vadSilenceDuration ?? 1200}
                  onChange={(e) => updateVoiceCall({ vadSilenceDuration: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Silence Threshold: {voiceCall.silenceThreshold}s
            </label>
            <input
              type="range"
              min={3} max={30} step={1}
              value={voiceCall.silenceThreshold}
              onChange={(e) => updateVoiceCall({ silenceThreshold: Number(e.target.value) })}
              className="w-full"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={voiceCall.cameraDefaultOn ?? false}
              onChange={(e) => updateVoiceCall({ cameraDefaultOn: e.target.checked })}
              className="rounded bg-slate-900 border-slate-700"
            />
            <span className="text-sm">通話開始時にカメラをON</span>
          </label>
          <p className="text-xs text-slate-500 -mt-2">
            カメラ画像は送信時のみLLMに渡され、履歴には保存されません。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-slate-400">Presets</h2>

          {presets?.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/settings/presets/${p.id}`)}
              className="w-full text-left p-3 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors"
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {p.model} / temp={p.temperature} / ctx={p.contextLength}
              </div>
            </button>
          ))}

          <button
            onClick={createPreset}
            className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm transition-colors"
          >
            + New Preset
          </button>
        </section>
      </div>
    </div>
  );
}
