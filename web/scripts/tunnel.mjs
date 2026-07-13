/**
 * Публичный доступ к демо через ngrok — БИБЛИОТЕКА (@ngrok/ngrok), не CLI.
 * Даёт HTTPS-ссылку, которую можно открыть на телефоне клиента.
 * (HTTPS нужен, чтобы работали гироскоп и «Поделиться».)
 *
 * Запуск:  npm run tunnel     (сначала подними приложение: npm run preview)
 *   или:   npm run demo       (build + preview + tunnel одной командой)
 *
 * Параметры через env (.env):
 *   NGROK_AUTHTOKEN  — токен агента ngrok (обязателен).
 *   NGROK_DOMAIN     — статический домен ngrok (необязательно; без него URL случайный).
 *   PORT             — порт приложения (по умолчанию 4173 — vite preview).
 */
import ngrok from '@ngrok/ngrok';

const authtoken = process.env.NGROK_AUTHTOKEN;
const domain = process.env.NGROK_DOMAIN || undefined;
const addr = Number(process.env.PORT || 4173);

if (!authtoken) {
  console.error('\n❌ Не задан NGROK_AUTHTOKEN (положите его в web/.env).');
  process.exit(1);
}

try {
  const listener = await ngrok.forward({ addr, authtoken, ...(domain ? { domain } : {}) });
  const url = listener.url();
  console.log('\n✅ Туннель поднят:');
  console.log('   ' + url);
  console.log(`   → проксирует на http://localhost:${addr}`);
  console.log('\n📱 Ссылки для клиента:');
  console.log('   Демо-тур:  ' + url + '/#/t/demo-apartment');
  console.log('   Главная:   ' + url + '/');
  console.log('\nДержите это окно открытым. Ctrl+C — остановить.\n');
} catch (e) {
  console.error('\n❌ Не удалось поднять туннель:');
  console.error('   ' + (e && e.message ? e.message : String(e)));
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
