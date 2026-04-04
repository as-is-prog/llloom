import { useNavigate } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  backTo?: string;
  right?: React.ReactNode;
}

export function PageHeader({ title, backTo, right }: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 bg-slate-950/80 backdrop-blur-sm px-4 py-3 border-b border-slate-800">
      {backTo && (
        <button
          onClick={() => navigate(backTo)}
          className="text-slate-400 hover:text-slate-200 -ml-1 p-1"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <h1 className="text-lg font-semibold truncate flex-1">{title}</h1>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </header>
  );
}
