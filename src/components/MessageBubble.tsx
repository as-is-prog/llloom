import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isLastAssistant?: boolean;
  isStreaming?: boolean;
  onEdit?: (newContent: string) => void;
  onRegenerate?: () => void;
}

export function MessageBubble({ role, content, isLastAssistant, isStreaming, onEdit, onRegenerate }: MessageBubbleProps) {
  const isUser = role === 'user';
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
      el.focus();
    }
  }, [editing]);

  const handleEditSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== content && onEdit) {
      onEdit(trimmed);
    }
    setEditing(false);
  };

  const handleEditCancel = () => {
    setEditValue(content);
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleEditSave();
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-3`}>
      <div className={`max-w-[85%] ${isUser ? 'flex flex-col items-end' : ''}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-slate-700 text-slate-100'
              : 'bg-slate-850 text-slate-200 border border-slate-800'
          }`}
        >
          {isUser && editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                ref={textareaRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                className="w-full resize-none bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-500"
                rows={1}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleEditCancel}
                  className="text-xs text-slate-400 hover:text-slate-300 px-2 py-1"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleEditSave}
                  className="text-xs bg-slate-600 hover:bg-slate-500 text-slate-200 px-3 py-1 rounded-md"
                >
                  送信
                </button>
              </div>
            </div>
          ) : isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none [&_pre]:bg-slate-900 [&_pre]:rounded-lg [&_code]:text-emerald-400 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5">
              <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
            </div>
          )}
        </div>

        {/* Action buttons — always visible for touch devices */}
        {isUser && !editing && onEdit && !isStreaming && (
          <button
            onClick={() => { setEditValue(content); setEditing(true); }}
            className="mt-1 text-xs text-slate-500 active:text-slate-200 hover:text-slate-300 transition-colors"
          >
            編集
          </button>
        )}
        {isLastAssistant && !isStreaming && onRegenerate && (
          <button
            onClick={onRegenerate}
            className="mt-1 text-xs text-slate-500 active:text-slate-200 hover:text-slate-300 transition-colors"
          >
            再生成
          </button>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex justify-start px-3">
      <div className="rounded-2xl px-4 py-3 bg-slate-850 border border-slate-800">
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
