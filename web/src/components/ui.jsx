import { useNavigate } from 'react-router-dom';

export function TopBar({ title, back, right }) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-gray-950/80 px-4 py-3 backdrop-blur">
      {back && (
        <button
          onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-gray-300 hover:bg-white/10"
          aria-label="Назад"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <h1 className="flex-1 truncate text-base font-semibold text-white">{title}</h1>
      {right}
    </header>
  );
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-indigo-500 text-white hover:bg-indigo-400 active:bg-indigo-600',
    ghost: 'bg-white/5 text-gray-200 hover:bg-white/10',
    danger: 'bg-red-500/10 text-red-300 hover:bg-red-500/20',
  }[variant];
  return (
    <button
      className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Screen({ children }) {
  return <div className="mx-auto flex min-h-full max-w-md flex-col">{children}</div>;
}
