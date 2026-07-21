/* Снимок с настоящей мобильной эмуляцией через CDP.
   headless Chrome не даёт окно уже 500px, поэтому вьюпорт задаём напрямую.

   Использование:
     node tools/shot.mjs <url> <out.png> <width> <height> <mobile|desktop> [prep.js] [waitMs]

   prep.js — файл с JS для страницы, из двух частей, разделённых строкой
   «// ПОСЛЕ:». Первая часть выполняется и затем страница перезагружается —
   там ставят localStorage (тема, черновик экзамена), чтобы приложение
   стартовало уже в нужном состоянии. Вторая часть выполняется после
   перезагрузки — там кликают по кнопкам, чтобы дойти до экрана, у которого
   нет собственного адреса (шаги анкеты, экраны вопросов, «спасибо»).
   Готовые примеры — в tools/prep/. */
import { writeFileSync, readFileSync } from 'node:fs';

const [, , url, out, wRaw, hRaw, mobileRaw, prepFile, waitRaw] = process.argv;

if (!url || !out) {
  console.error('нужны как минимум url и путь к файлу:\n' +
    '  node tools/shot.mjs <url> <out.png> [width] [height] [mobile|desktop] [prep.js] [waitMs]');
  process.exit(2);
}
const width = Number(wRaw) || 390;
const height = Number(hRaw) || 844;
const mobile = mobileRaw !== 'desktop';
const settle = waitRaw == null ? 2500 : Number(waitRaw); // 0 — допустимая пауза
const PORT = process.env.CDP_PORT || 9222;

let prepBefore = '';
let prepAfter = '';
if (prepFile) {
  const parts = readFileSync(prepFile, 'utf8').split(/^\/\/ ПОСЛЕ:.*$/m);
  prepBefore = parts[0] || '';
  prepAfter = parts[1] || '';
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(list.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});

/* Каждый запрос с таймаутом: обрыв CDP иначе вешает скрипт молча и навсегда */
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const myId = ++id;
  const timer = setTimeout(() => {
    pending.delete(myId);
    reject(new Error('CDP не ответил на ' + method + ' за 30 с'));
  }, 30000);
  pending.set(myId, (msg) => { clearTimeout(timer); resolve(msg); });
  ws.send(JSON.stringify({ id: myId, method, params }));
});

ws.addEventListener('error', () => {
  console.error('CDP: соединение с Chrome оборвалось. Запущен ли он с --remote-debugging-port=9222?');
  process.exit(1);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  });
  const thrown = res.result?.exceptionDetails;
  if (thrown) throw new Error('prep упал: ' + (thrown.exception?.description || thrown.text));
  return res.result?.result?.value;
}

await new Promise((r) => ws.addEventListener('open', r));

await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile,
  screenWidth: width, screenHeight: height
});
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await wait(settle);

/* Профиль Chrome общий для всех прогонов, поэтому localStorage от прошлого
   снимка протекает в следующий. Чистим состояние приложения перед prep —
   иначе тёмная тема «липнет» к последующим светлым снимкам. */
await evaluate(
  'Object.keys(localStorage).filter(function (k) { return k.indexOf("tajweed_") === 0; })' +
  '.forEach(function (k) { localStorage.removeItem(k); });'
);

await evaluate(prepBefore.trim() || '0');
await send('Page.reload');
await wait(settle);

if (prepAfter.trim()) {
  await evaluate(prepAfter);
  await wait(900);
}

console.log('вьюпорт:', await evaluate(
  'JSON.stringify({vw: innerWidth, sw: document.documentElement.scrollWidth,' +
  ' theme: document.documentElement.getAttribute("data-theme")})'
));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('сохранено:', out);

await send('Page.close');
ws.close();
process.exit(0);
