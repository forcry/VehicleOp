'use strict';
/* 3D globe + radar scope for AWARENESS. Draws only real data from app.js services; nothing is simulated. */
(() => {
const gEl = $('#globe'); let G = null, view = 'globe', flown = false, ang = 0;
function init() {
  if (G) return resize(); if (!window.Globe) return emit('GLOBE', '3D library failed to load (internet/CDN) — use FLAT MAP', 'globe.gl', 'ERROR');
  const img = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/';
  G = Globe()(gEl).width(gEl.clientWidth).height(gEl.clientHeight).backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl(img + 'earth-night.jpg').bumpImageUrl(img + 'earth-topology.png').atmosphereColor('#37c8e0').atmosphereAltitude(.28)
    .pointLat('lat').pointLng('lng').pointAltitude('alt').pointColor('c').pointRadius('r').pointLabel('label')
    .labelLat('lat').labelLng('lng').labelAltitude('alt').labelText('name').labelSize(.55).labelDotRadius(.25).labelColor(() => '#37c8e0')
    .ringLat('lat').ringLng('lng').ringMaxRadius('mr').ringPropagationSpeed(2.5).ringRepeatPeriod(1400).ringColor(() => t => `rgba(55,200,224,${1 - t})`);
  G.controls().autoRotate = true; G.controls().autoRotateSpeed = .5; update();
}
function resize() { if (G) G.width(gEl.clientWidth).height(gEl.clientHeight); }
function update() {
  if (!G || $('#awr').hidden || view !== 'globe') return;
  const p = pos(), L = S.layers, pts = [], lab = [];
  if (L.sats) (sat.data.all || []).forEach(s => { const up = s.el > 0, a = Math.min(s.alt / 6371, .6);
    pts.push({ lat: s.lat, lng: s.lon, alt: a, c: up ? '#ffffff' : '#3b82f6', r: up ? .45 : .22, label: `<b>${s.name}</b><br>${s.alt.toFixed(0)} km${up ? ' · EL ' + s.el.toFixed(0) + '°' : ''}` });
    if (up && lab.length < 8) lab.push({ lat: s.lat, lng: s.lon, alt: a + .01, name: s.name }); });
  if (L.aircraft) (air.data.list || []).forEach(a => pts.push({ lat: a.lat, lng: a.lon, alt: .004 + (a.alt_ft || 0) / 35000 * .01, c: '#34d399', r: .12, label: `<b>${a.callsign || 'N/A'}</b><br>${a.alt_ft ?? '?'} ft · ${a.gs_kt ?? '?'} kt` }));
  if (L.quakes) (quake.data.feed || []).filter(q => q.mag >= 3.5).slice(0, 300).forEach(q => pts.push({ lat: q.lat, lng: q.lon, alt: .003, c: '#e0b341', r: .15 + q.mag * .07, label: `<b>M${q.mag.toFixed(1)}</b><br>${q.place}` }));
  if (L.user && p) pts.push({ lat: p.lat, lng: p.lon, alt: .006, c: '#37c8e0', r: .4, label: 'YOU' });
  G.pointsData(pts).labelsData(lab).ringsData(L.user && p ? [{ lat: p.lat, lng: p.lon, mr: 4 }] : []);
  if (p && !flown) { flown = true; G.controls().autoRotate = false; G.pointOfView({ lat: p.lat, lng: p.lon, altitude: 1.4 }, 2000); }
}
function show(v) { view = v; $('#globe').hidden = v !== 'globe'; $('#lmap').hidden = v === 'globe';
  $('#vG').classList.toggle('on', v === 'globe'); $('#vF').classList.toggle('on', v !== 'globe');
  if (v === 'globe') { init(); update(); } else if (M) setTimeout(() => { M.invalidateSize(); mapDraw(true); }, 50); }
$('#vG').onclick = () => show('globe'); $('#vF').onclick = () => show('flat');
$('#gMe').onclick = () => { const p = pos(); if (G && p) { G.controls().autoRotate = false; G.pointOfView({ lat: p.lat, lng: p.lon, altitude: .12 }, 1500); } };
$('#gW').onclick = () => { if (G) { G.controls().autoRotate = true; G.pointOfView({ altitude: 2.6 }, 1500); } };
$('#tabA').addEventListener('click', () => setTimeout(() => { if (view === 'globe') { init(); update(); } }, 80));
addEventListener('resize', resize); setInterval(update, 3000);

/* ---- radar scope: real aircraft + quakes inside the selected radius, sweep is cosmetic ---- */
const rc = $('#radar'), rx = rc.getContext('2d');
setInterval(() => {
  if ($('#awr').hidden) return; const W = rc.width, H = rc.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 16, p = pos(); rx.clearRect(0, 0, W, H);
  rx.lineWidth = 1; rx.strokeStyle = '#1f3a44'; rx.fillStyle = '#4f7683'; rx.font = '11px system-ui';
  [1, .75, .5, .25].forEach(f => { rx.beginPath(); rx.arc(cx, cy, R * f, 0, 7); rx.stroke(); rx.fillText(Math.round(S.radius * f) + ' km', cx + 3, cy - R * f + 11); });
  rx.beginPath(); rx.moveTo(cx - R, cy); rx.lineTo(cx + R, cy); rx.moveTo(cx, cy - R); rx.lineTo(cx, cy + R); rx.stroke(); rx.fillText('N', cx - 3, cy - R - 3);
  ang = (ang + 2.4) % 360;
  const g = rx.createConicGradient(rad(ang - 90 - 60), cx, cy); g.addColorStop(0, 'rgba(55,200,224,0)'); g.addColorStop(.1666, 'rgba(55,200,224,.35)'); g.addColorStop(.1667, 'rgba(55,200,224,0)'); g.addColorStop(1, 'rgba(55,200,224,0)');
  rx.fillStyle = g; rx.beginPath(); rx.arc(cx, cy, R, 0, 7); rx.fill();
  rx.strokeStyle = '#37c8e0'; rx.beginPath(); rx.moveTo(cx, cy); rx.lineTo(cx + R * Math.sin(rad(ang)), cy - R * Math.cos(rad(ang))); rx.stroke();
  $('#rdsrc').textContent = `radius ${S.radius} km · aircraft ${air.status}`;
  if (!p) { rx.fillStyle = '#7d8b9b'; rx.fillText('RADAR: NEEDS GPS', cx - 50, cy + 30); return; }
  const blip = (d, b, col, txt) => { if (d > S.radius) return; const r = R * d / S.radius, x = cx + r * Math.sin(rad(b)), y = cy - r * Math.cos(rad(b));
    rx.globalAlpha = Math.max(.3, 1 - ((ang - b + 360) % 360) / 360); rx.fillStyle = col; rx.beginPath(); rx.arc(x, y, 4, 0, 7); rx.fill(); if (txt) rx.fillText(txt, x + 6, y + 3); rx.globalAlpha = 1; };
  if (S.layers.quakes) (quakes() || []).forEach(q => blip(q.d, q.b, '#e0b341', 'M' + (q.mag ?? 0).toFixed(1)));
  if (S.layers.aircraft) (air.data.list || []).forEach(a => blip(a.d, a.b, '#34d399', a.callsign));
  rx.fillStyle = '#37c8e0'; rx.beginPath(); rx.arc(cx, cy, 4, 0, 7); rx.fill();
}, 50);
})();
