// Remote logging: pipe browser events/errors to the backend so they land in the
// server console (demo.log). Lets us debug phone-only flows (gyro/camera/stitch).
let SEQ = 0;

function post(level, msg, data) {
  try {
    navigator.sendBeacon?.(
      '/api/log',
      new Blob([JSON.stringify({ level, msg, data, seq: SEQ++ })], { type: 'application/json' }),
    ) ||
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, msg, data, seq: SEQ++ }),
        keepalive: true,
      });
  } catch {
    /* ignore */
  }
  try { console.log(`[rlog:${level}]`, msg, data ?? ''); } catch { /* ignore */ }
}

export const rlog = (msg, data) => post('log', msg, data);
export const rerr = (msg, data) => post('err', msg, data);

export function installGlobalLog() {
  if (window.__rlogInstalled) return;
  window.__rlogInstalled = true;
  window.addEventListener('error', (e) =>
    rerr('window.onerror', { m: e.message, src: e.filename, line: e.lineno, col: e.colno }),
  );
  window.addEventListener('unhandledrejection', (e) =>
    rerr('unhandledrejection', { reason: String(e.reason?.stack || e.reason) }),
  );
  rlog('boot', { ua: navigator.userAgent, url: location.href, secure: window.isSecureContext });
}
