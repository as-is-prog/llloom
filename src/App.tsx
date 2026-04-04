import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RoomList } from './pages/RoomList';
import { RoomDetail } from './pages/RoomDetail';
import { Chat } from './pages/Chat';
import { Settings } from './pages/Settings';
import { RoomEdit } from './pages/RoomEdit';
import { PresetEdit } from './pages/PresetEdit';

export default function App() {
  return (
    <BrowserRouter basename="/llloom">
      <div className="min-h-dvh bg-slate-950 text-slate-100">
        <Routes>
          <Route path="/" element={<RoomList />} />
          <Route path="/rooms/:roomId" element={<RoomDetail />} />
          <Route path="/rooms/:roomId/edit" element={<RoomEdit />} />
          <Route path="/rooms/:roomId/chat/:convId" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/presets/:presetId" element={<PresetEdit />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
