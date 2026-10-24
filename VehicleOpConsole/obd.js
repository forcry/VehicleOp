'use strict';
/* OBD-II over Web Bluetooth (BLE ELM327 adapters). READ-ONLY: only Mode 01 PIDs + ATRV are ever sent. */
(() => {
const U = [[0xFFF0, 0xFFF1, 0xFFF2], [0xFFE0, 0xFFE1, 0xFFE1], [0x18F0, 0x2AF0, 0x2AF1], ['e7810a71-73ae-499d-8c15-faa9aef0c3f2', 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f']];
const enc = new TextEncoder(), dec = new TextDecoder();
let dev, wr, buf = '', waiter = null, gen = 0, wl = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function onData(e) { buf += dec.decode(e.target.value); if (buf.includes('>')) { const r = buf.replace(/[\r\n]+/g, ' ').replace('>', '').trim(); buf = ''; if (waiter) { const w = waiter; waiter = null; w(r); } } }
const send = (c, t = 4000) => new Promise((res, rej) => {
  const to = setTimeout(() => { waiter = null; rej(new Error('timeout ' + c)); }, t);
  waiter = r => { clearTimeout(to); res(r); };
  const d = enc.encode(c + '\r'); (wr.writeValueWithoutResponse ? wr.writeValueWithoutResponse(d) : wr.writeValue(d)).catch(rej);
});
async function pid(p) { // returns data bytes array or null (unsupported)
  const r = (await send('01' + p)).replace(/\s/g, '').toUpperCase(), m = r.match(new RegExp('41' + p + '([0-9A-F]+)'));
  return m ? m[1].match(/../g).map(h => parseInt(h, 16)) : null;
}
async function link() {
  const srv = await dev.gatt.connect(); let ok = false;
  for (const [s, n, w] of U) { try { const sv = await srv.getPrimaryService(s), nc = await sv.getCharacteristic(n); wr = await sv.getCharacteristic(w);
    await nc.startNotifications(); nc.addEventListener('characteristicvaluechanged', onData); ok = true; break; } catch {} }
  if (!ok) { let seen = ''; try { seen = (await srv.getPrimaryServices()).map(x => x.uuid.slice(4, 8)).join(','); } catch {} throw new Error(`No OBD serial service on "${dev.name}" (found: ${seen || 'none'}). Wrong device, or adapter is Bluetooth Classic.`); }
  for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) { await send(c, 6000); await sleep(100); }
}
async function loop(my) {
  let n = 0, last = {};
  while (my === gen) {
    const d = {};
    try {
      const sp = await pid('0D'); if (sp) d.speed = sp[0] * 0.621371;
      const rp = await pid('0C'); if (rp) { d.rpm = (rp[0] * 256 + rp[1]) / 4; d.engine = d.rpm > 0 ? 'RUNNING' : 'OFF'; }
      if (n % 5 === 0) {
        const ct = await pid('05'); if (ct) d.coolant = (ct[0] - 40) * 1.8 + 32;
        const fl = await pid('2F'); if (fl) d.fuel = fl[0] * 100 / 255;
        const v = (await send('ATRV')).match(/([\d.]+)\s*V/i); if (v) d.voltage = +v[1];
      }
      d.obd = 'CONNECTED'; last = { ...last, ...d }; set(veh, 'LIVE', d); n++;
    } catch (e) { if (my !== gen) return; set(veh, 'OFFLINE', null, e.message); emit('OBD', 'POLL FAILED: ' + e.message, veh.source, 'ERROR'); return reconnect(my); }
  }
}
async function reconnect(my) {
  bt.data.obd = false; set(bt, 'LIVE', { sub: 'RECONNECTING' }); let lg = 0;
  while (my === gen) { await sleep(3000); try { await link(); bt.data.obd = true; emit('OBD', 'RECONNECTED', veh.source, 'LIVE'); return loop(my); } catch (e) { if (!lg) { lg = 1; emit('OBD', 'RETRY FAILED: ' + e.message, veh.source, 'ERROR'); } } }
}
async function connect() {
  if (!navigator.bluetooth) return emit('OBD', 'Web Bluetooth unavailable — use Chrome on Android/desktop over HTTPS', 'browser', 'ERROR');
  try {
    if (S.demo) setDemo(false);
    dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: U.map(u => u[0]) });
    veh.source = (dev.name || 'OBD adapter') + ' (OBD-II)'; const my = ++gen;
    dev.addEventListener('gattserverdisconnected', () => { if (my === gen) { emit('OBD', 'ADAPTER DISCONNECTED — retrying', veh.source, 'WARN'); set(veh, 'OFFLINE', null, 'link lost'); reconnect(my); } });
    emit('OBD', 'CONNECTING to ' + veh.source, veh.source, 'INFO'); await link();
    bt.data.obd = true; set(bt, 'LIVE', { sub: 'ONLINE' }); emit('OBD', 'CONNECTED — read-only polling', veh.source, 'LIVE'); loop(my);
  } catch (e) { if (e.name !== 'NotFoundError') emit('OBD', 'CONNECT FAILED: ' + e.message, 'Web Bluetooth', 'ERROR'); }
}
$('#obdBtn').onclick = connect; $('#dobd').onclick = connect;

/* ---------- Drive Mode: glanceable, zero-interaction, screen kept awake ---------- */
const dr = $('#drive');
async function wake() { try { wl = await navigator.wakeLock.request('screen'); } catch {} }
$('#driveBtn').onclick = () => { dr.hidden = false; wake(); };
$('#dx').onclick = () => { dr.hidden = true; wl && wl.release(); };
document.addEventListener('visibilitychange', () => { if (!dr.hidden && document.visibilityState === 'visible') wake(); });
const T = (l, v, hot) => `<div class="dt${hot ? ' hot' : ''}"><small>${l}</small><b>${v}</b></div>`;
const f = (x, d = 0) => x == null ? '—' : x.toFixed(d);
setInterval(() => {
  if (dr.hidden) return; const d = veh.data, g = gps.data, obdOk = live(veh) && d.speed != null;
  const s = obdOk ? d.speed : (gps.status === 'LIVE' && g.speed != null ? g.speed * 2.237 : null);
  $('#dspd').textContent = s == null ? '—' : Math.round(s);
  $('#dsrc').textContent = obdOk ? 'SPEED · OBD' : s != null ? 'SPEED · GPS (OBD NOT CONNECTED)' : 'NO SPEED SOURCE';
  $('#dgrid').innerHTML = T('RPM', f(d.rpm)) + T('COOLANT °F', f(d.coolant), d.coolant > 230) + T('FUEL %', f(d.fuel), d.fuel != null && d.fuel < 12) + T('VOLTS', f(d.voltage, 1), d.voltage != null && d.voltage < 11.8);
  $('#dobd').hidden = obdOk;
}, 400);
})();
