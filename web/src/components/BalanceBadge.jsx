import { useEffect, useState } from 'react';

// Tiny, unobtrusive OpenRouter key balance shown at the very top of the app.
// Refreshes on mount and every 60s. Renders nothing until a value is known.
export default function BalanceBadge() {
  const [bal, setBal] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/balance')
        .then((r) => r.json())
        .then((j) => { if (alive && j?.ok) setBal(j); })
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!bal) return null;
  return (
    <div
      className="pointer-events-none fixed right-2 top-0.5 z-[60] select-none text-[10px] font-medium leading-none text-emerald-300/70"
      title={`OpenRouter balance — used $${bal.usage} of $${bal.total}`}
    >
      ${bal.remaining.toFixed(2)}
    </div>
  );
}
