import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { fetchModels } from '../lib/api';
import { useSettingsStore } from '../stores/settingsStore';
import { PageHeader } from '../components/PageHeader';

export function PresetEdit() {
  const { presetId } = useParams<{ presetId: string }>();
  const navigate = useNavigate();

  const settings = useSettingsStore();
  const preset = useLiveQuery(() => db.presets.get(presetId!), [presetId]);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const models = await fetchModels({
        endpointUrl: settings.endpointUrl,
        apiType: settings.apiType,
        apiToken: settings.apiToken,
        lmStudioIntegrations: settings.lmStudioIntegrations,
      });
      setAvailableModels(models);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Failed to fetch models');
    } finally {
      setModelsLoading(false);
    }
  }, [settings.endpointUrl, settings.apiType, settings.apiToken, settings.lmStudioIntegrations]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.2);
  const [topP, setTopP] = useState(0.9);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [frequencyPenalty, setFrequencyPenalty] = useState(1.1);
  const [presencePenalty, setPresencePenalty] = useState(0);
  const [contextLength, setContextLength] = useState(65535);

  useEffect(() => {
    if (preset) {
      setName(preset.name);
      setModel(preset.model);
      setTemperature(preset.temperature);
      setTopP(preset.topP);
      setMaxTokens(preset.maxTokens);
      setFrequencyPenalty(preset.frequencyPenalty);
      setPresencePenalty(preset.presencePenalty);
      setContextLength(preset.contextLength);
    }
  }, [preset]);

  const save = async () => {
    if (!presetId) return;
    await db.presets.update(presetId, {
      name: name.trim() || 'Untitled',
      model: model.trim(),
      temperature,
      topP,
      maxTokens,
      frequencyPenalty,
      presencePenalty,
      contextLength,
    });
    navigate('/settings');
  };

  const deletePreset = async () => {
    if (!presetId) return;
    // Check if any rooms use this preset
    const rooms = await db.rooms.where('presetId').equals(presetId).count();
    if (rooms > 0) {
      alert(`このプリセットは${rooms}個のRoomで使用中です。先にRoomのプリセットを変更してください。`);
      return;
    }
    await db.presets.delete(presetId);
    navigate('/settings');
  };

  if (!preset) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <PageHeader
        title="Edit Preset"
        backTo="/settings"
        right={
          <button onClick={save} className="text-sm text-blue-400 hover:text-blue-300 font-medium">
            Save
          </button>
        }
      />

      <div className="flex-1 p-4 space-y-4">
        <Field label="Name" value={name} onChange={setName} />

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-slate-500">Model</label>
            <button
              onClick={loadModels}
              disabled={modelsLoading}
              className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50"
            >
              {modelsLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          {availableModels.length > 0 ? (
            <select
              value={availableModels.includes(model) ? model : '__custom__'}
              onChange={(e) => {
                if (e.target.value !== '__custom__') setModel(e.target.value);
              }}
              className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
            >
              {!availableModels.includes(model) && (
                <option value="__custom__">{model || 'Select a model'}</option>
              )}
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="llama3, gemma2, etc."
              className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
            />
          )}
          {modelsError && (
            <p className="text-xs text-amber-500 mt-1">{modelsError}</p>
          )}
        </div>

        <SliderField label="Temperature" value={temperature} onChange={setTemperature} min={0} max={2} step={0.1} />
        <SliderField label="Top P" value={topP} onChange={setTopP} min={0} max={1} step={0.05} />
        <NumberField label="Max Tokens" value={maxTokens} onChange={setMaxTokens} min={1} max={131072} />
        <NumberField label="Context Length" value={contextLength} onChange={setContextLength} min={512} max={131072} />
        <SliderField label="Frequency Penalty" value={frequencyPenalty} onChange={setFrequencyPenalty} min={-2} max={2} step={0.1} />
        <SliderField label="Presence Penalty" value={presencePenalty} onChange={setPresencePenalty} min={-2} max={2} step={0.1} />

        <div className="pt-4 border-t border-slate-800">
          <button
            onClick={deletePreset}
            className="w-full py-2.5 rounded-lg bg-red-950 border border-red-900 text-red-400 hover:bg-red-900 text-sm transition-colors"
          >
            Delete Preset
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
      />
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-400 tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full accent-slate-500"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
        min={min}
        max={max}
        className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
      />
    </div>
  );
}
