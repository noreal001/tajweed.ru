/* Снимок с настоящей мобильной эмуляцией через CDP.
   headless Chrome не даёт окно уже 500px, поэтому вьюпорт задаём напрямую. */
import { writeFileSync } from 'node:fs';

const [, , url, out, wRaw, hRaw, mobileRaw] = process.argv;
const width = Number(wRaw) || 390;
const height = Number(hRaw) || 844;
const mobile = mobileRaw !== 'desktop';
const PORT = process.env.CDP_PORT || 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(list.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});

const send = (method, params = {}) => new Promise((resolve) => {
  const myId = ++id;
  pending.set(myId, resolve);
  ws.send(JSON.stringify({ id: myId, method, params }));
});

await new Promise((r) => ws.addEventListener('open', r));

await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile,
  screenWidth: width, screenHeight: height
});
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 2500));

const metrics = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({vw: innerWidth, sw: document.documentElement.scrollWidth})',
  returnByValue: true
});
console.log('вьюпорт:', metrics.result?.result?.value);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('сохранено:', out);

await send('Page.close');
ws.close();
process.exit(0);
