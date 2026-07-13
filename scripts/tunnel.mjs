/**
 * Публичный доступ через ngrok. Проксирует на локальный Express (SPA + API + /uploads).
 * Запуск: npm run demo  (build + start + tunnel)  или  npm run tunnel (если сервер уже поднят).
 * Env (server/.env): NGROK_AUTHTOKEN (обяз.), NGROK_DOMAIN (опц.), PORT (по умолч. 8787).
 */
import ngrok from '@ngrok/ngrok';

const authtoken = process.env.NGROK_AUTHTOKEN;
const domain = process.env.NGROK_DOMAIN || undefined;
const addr = Number(process.env.PORT || 8787);

if (!authtoken) {
  console.error('\n❌ Не задан NGROK_AUTHTOKEN (в server/.env).');
  process.exit(1);
}

try {
  const listener = await ngrok.forward({ addr, authtoken, ...(domain ? { domain } : {}) });
  const url = listener.url();
  console.log('\n✅ Туннель поднят: ' + url);
  console.log(`   → http://localhost:${addr}`);
  console.log('\n📱 Открой на телефоне: ' + url + '\n');
} catch (e) {
  console.error('\n❌ Туннель не поднялся: ' + (e?.message || e));
  process.exit(1);
}

const keep = setInterval(() => {}, 1 << 30);
const stop = async () => {
  clearInterval(keep);
  try { await ngrok.disconnect(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
