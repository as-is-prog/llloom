import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { generateId } from '../lib/utils';
import { useSettingsStore } from '../stores/settingsStore';
import { PageHeader } from '../components/PageHeader';
import type { Preset } from '../types';

export function Settings() {
  const navigate = useNavigate();
  const { endpointUrl, apiType, update } = useSettingsStore();
  const presets = useLiveQuery(() => db.presets.toArray());

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
              onChange={(e) => update({ apiType: e.target.value as 'ollama' | 'openai' })}
              className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
            >
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI Compatible (LM Studio etc.)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Endpoint URL</label>
            <input
              value={endpointUrl}
              onChange={(e) => update({ endpointUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="w-full bg-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
            />
          </div>
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
