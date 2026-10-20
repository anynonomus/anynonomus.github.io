import payload from './payload.js';
import { Court } from './scene.js';
import * as sfx from './audio.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');
const fontsReady = () => document.fonts.load('64px Anton');

// progress lives only in her own browser
const KEY = 'gameday';
// ?fresh wipes this device's progress so the whole thing plays from the riddle again
if (new URLSearchParams(location.search).has('fresh')) {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  history.replaceState(null, '', location.pathname);
}
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* private mode */ } };
const P = Object.assign({ n: 0, done: false, seen: [] }, load());

let C, court, mode = 'cards', streak = 0;

if (!window.crypto?.subtle || !window.WebGLRenderingContext) {
  hide($('#lock')); show($('#fail'));
} else {
  court = new Court($('#gl'));
  fontsReady().then(() => { if (!C) { court.drawSigns(); court.drawBoards(); court.court.draw(); } });
  boot();
}

// ---------- unlock ----------
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(payload.salt), iterations: payload.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(payload.iv) }, key, b64(payload.data));
  return JSON.parse(new TextDecoder().decode(data));
}
const normalize = (s) => {
  const t = s.toLowerCase().replace(/[^a-z]/g, '').replace(/^(a|the|its|itsa|itsthe)(?=basket|bball)/, '');
  return ['basketball', 'basketballs', 'bball'].includes(t) ? 'basketball' : t;
};

async function boot() {
  if (P.pass) {
    try {
      C = await decrypt(P.pass);
      await fontsReady();
      court.personalize(C.name, C.number, C.cards.length);
      hide($('.lock-card'));
      $('#backName').textContent = `Hey ${C.name}. The court's still yours.`;
      show($('#backCard'));
      $('#backBtn').onclick = () => { sfx.initAudio(); start(true); };
      return;
    } catch { delete P.pass; save(); }
  }
  let tries = 0;
  const hints = ['', 'Not quite. Read it again, slowly.', 'Hint: u have probably held one today.', "It's orange. U live on a court with it."];
  $('#lockForm').onsubmit = async (e) => {
    e.preventDefault();
    sfx.initAudio();
    const card = $('.lock-card'), raw = $('#answer').value.trim();
    if (!raw) return;
    card.classList.add('busy');
    try {
      const pass = normalize(raw);
      C = await decrypt(pass);
      P.pass = pass; save();
      $('#answer').blur();
      await fontsReady();
      court.personalize(C.name, C.number, C.cards.length);
      start(false);
    } catch {
      tries++;
      sfx.wrong();
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      $('#hint').textContent = hints[Math.min(tries, hints.length - 1)];
    }
    card.classList.remove('busy');
  };
}

function start(returning) {
  show($('#mute'));
  P.first ||= new Date().toISOString(); save();
  $('#mute').onclick = () => { sfx.setMuted(!sfx.isMuted()); $('#mute').classList.toggle('muted', sfx.isMuted()); };
  court.on.score = onScore;
  court.on.miss = onMiss;
  court.on.shot = () => $('#swipeHint').classList.add('gone');
  court.setScore(P.n);
  sfx.chime();
  $('#lock .glass:not(.hidden)').classList.add('leave');
  setTimeout(() => hide($('#lock')), 600);
  if (returning && P.done) return court.reveal().then(locker);
  if (returning && P.n > 0) return court.reveal().then(() => game());
  intro();
}

// ---------- intro ----------
async function typeText(el, text, speed = 38) {
  el.textContent = '';
  for (const ch of text) { el.textContent += ch; await sleep(speed); }
}

async function intro() {
  show($('#intro'));
  sfx.startAmbient();
  sfx.cheer(2.2, 0.5);
  court.reveal();
  await sleep(1500);
  await typeText($('#kicker'), C.intro.kicker);
  await sleep(500);
  await typeText($('#line1'), C.intro.line1, 32);
  await sleep(700);
  const name = [...C.name.toUpperCase()].map((c, i) => `<span class="ch" style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
  $('#star').innerHTML = `<span class="num">#${esc(C.number)}</span>${name}`;
  sfx.bounce(1); sfx.cheer(3.6, 1.1);
  court.introBurst();
  await sleep(2400);
  $('#line2').textContent = C.intro.line2; $('#line2').classList.add('on');
  await sleep(1700);
  $('#line3').textContent = C.intro.line3; $('#line3').classList.add('on');
  await sleep(900);
  $('#dragHint').classList.add('on');
  court.on.look = () => { $('#dragHint').classList.remove('on'); court.on.look = null; };
  show($('#takeCourt'));
  $('#takeCourt').onclick = async () => {
    sfx.tap(); sfx.whoosh();
    $('#intro').classList.add('leave');
    await sleep(500);
    hide($('#intro')); $('#intro').classList.remove('leave');
    game();
  };
}

// ---------- game ----------
const TOTAL = () => C.cards.length;

function renderDots() {
  if (mode === 'free') {
    $('#sbLabel').textContent = 'Streak';
    $('#dots').innerHTML = '';
    $('#sbCount').textContent = streak;
    return;
  }
  $('#sbLabel').textContent = 'Buckets';
  $('#sbCount').textContent = '';
  $('#dots').innerHTML = Array.from({ length: TOTAL() }, (_, i) => `<i class="${i < P.n ? 'on' : ''}"></i>`).join('');
}

async function game(free = false) {
  mode = free ? 'free' : 'cards';
  streak = 0;
  renderDots();
  show($('#hud'));
  $('#toLocker').classList.toggle('hidden', !free);
  $('#toLocker').onclick = () => { sfx.tap(); court.shooting = false; hide($('#hud')); locker(); };
  $('#swipeHint').classList.toggle('gone', P.n > 0 || free);
  court.setScore(P.n, free ? 'SHOOTAROUND' : 'FREE THROW LINE');
  sfx.startAmbient();
  await court.toGame();
  court.shooting = true;
}

const SCORE_WORDS = { swish: ['Swish!', 'Nothing but net', 'Cash.', 'Splash!'], bank: ['Off the glass!', 'Bank it!'], rim: ['Rattled in!', 'Friendly roll!'] };
const MISS_WORDS = { rim: ['So close', 'Rim said no', 'In and out?!'], air: ['Brick 😭', 'Airball…', 'We saw nothing.'] };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function toast(text, sub = '') {
  const t = $('#toast');
  t.innerHTML = `<b>${esc(text)}</b>` + (sub ? `<br><small>${esc(sub)}</small>` : '');
  t.classList.remove('go'); void t.offsetWidth; t.classList.add('go');
}

let missRun = 0;
async function onScore(kind) {
  missRun = 0;
  $('#tip').classList.remove('on');
  court.celebrate();
  sfx.cheer(1.8, 0.9);
  const word = pick(SCORE_WORDS[kind]);
  if (mode === 'free') {
    streak++; renderDots();
    court.setScore(streak, word.toUpperCase());
    toast(word, streak > 2 ? `${streak} in a row` : '');
    return;
  }
  court.shooting = false;
  const i = P.n;
  P.n++; save();
  renderDots();
  court.setScore(P.n, word.toUpperCase());
  toast(word, P.n < TOTAL() ? 'Unlocked something' : 'That was the last one');
  await sleep(1500);
  court.resetBall();
  await openCard(i);
  if (P.n >= TOTAL()) finale();
  else court.shooting = true;
}

function onMiss(kind) {
  if (mode === 'free') { streak = 0; renderDots(); court.setScore(0, 'RUN IT BACK'); }
  missRun++;
  toast(pick(MISS_WORDS[kind]));
  if (missRun >= 2) {
    $('#tip').textContent = 'Swipe straight up, about a third of the screen.';
    $('#tip').classList.add('on');
  }
}

// ---------- sheet ----------
function sheet(html, { button = 'Back to the court', onMount } = {}) {
  const wrap = $('#sheet'), body = $('#sheetBody');
  body.innerHTML = html; body.scrollTop = 0;
  $('#sheetClose').querySelector('span').textContent = button;
  show(wrap);
  sfx.whoosh();
  onMount?.(body);
  return new Promise((done) => {
    $('#sheetClose').onclick = async () => {
      sfx.tap();
      wrap.classList.add('closing');
      await sleep(340);
      wrap.classList.remove('closing'); hide(wrap); body.innerHTML = '';
      done();
    };
  });
}

const head = (c) => `<p class="eyebrow in">${esc(c.eyebrow)}</p><h2 class="in" style="--i:1">${esc(c.title)}</h2>`;
const paras = (ps, from = 2) => ps.map((p, i) => `<p class="para in" style="--i:${i + from}">${esc(p)}</p>`).join('');

const BUST = '<div class="tc-q">?</div>';

function tradingCard(c, art, violet) {
  const v = violet ? ' violet' : '';
  return `<div class="tc-stage"><div class="tcard" data-card>
    <div class="tc-inner">
      <div class="tc-face tc-front${v}"><div class="tc-window">
        <div class="tc-prizm"></div>
        <div class="tc-art">${art}</div>
        <div class="tc-top"><span>${esc(c.series)}</span><span class="tc-serial">${esc(c.serial)}</span></div>
        <div class="tc-ovr"><b>99</b><small>OVR</small></div>
        <div class="tc-rc">RC</div>
        <div class="tc-name"><b>${esc(C.name)}</b><span>#${esc(C.number)} · ${esc(c.position)}</span></div>
        <div class="tc-parallel">${esc(c.parallel)}</div>
        <div class="tc-foil"></div><div class="tc-glare"></div>
      </div></div>
      <div class="tc-face tc-back${v}"><div class="tc-window">
        <div class="tb-head"><b>${esc(C.name)}</b><span>NO. 00${esc(C.number)}</span></div>
        <div class="tb-bio">${c.bio.map(([k, val]) => `<div><small>${esc(k)}</small><b>${esc(val)}</b></div>`).join('')}</div>
        <div class="tb-attr">${c.attrs.map(([k, val]) => `<div>${esc(k.toUpperCase())}<b>${val}</b><i style="--v:${Math.min(100, val)}"></i></div>`).join('')}</div>
        <p class="tb-note">${esc(c.note)}</p>
        <p class="tb-foot">${esc(c.foot)}</p>
      </div></div>
    </div>
  </div></div>
  <p class="tap-flip">tap the card to flip it · drag to tilt</p>`;
}

const RENDER = {
  list: (c) => `${head(c)}<p class="lead in" style="--i:2">${esc(c.lead)}</p>
    <ol class="scout">${c.items.map(([a, b], i) => `<li class="in" data-n="${i + 1}" style="--i:${i + 3}"><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('')}</ol>
    <div class="stamp" style="animation-delay:${0.4 + c.items.length * 0.08}s">${esc(c.verdict)}</div>`,

  player: (c) => `${head(c)}<p class="lead in" style="--i:2">${esc(c.lead)}</p>${tradingCard(c, C.action, false)}`,
  persona: (c) => `${head(c)}<p class="lead in" style="--i:2">${esc(c.lead)}</p>${tradingCard(c, BUST, true)}`,

  story: (c) => `${head(c)}${paras(c.paras)}
    <svg class="trend in" style="--i:5" viewBox="0 0 320 150">
      <defs>
        <linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#ff7a1a"/></linearGradient>
        <linearGradient id="ta" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity="0.35"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></linearGradient>
      </defs>
      <path class="area" d="M10 92 C40 70 55 120 85 112 C115 104 120 74 150 84 C180 94 190 60 220 52 C250 44 270 30 310 14 L310 150 L10 150Z"/>
      <path class="line" d="M10 92 C40 70 55 120 85 112 C115 104 120 74 150 84 C180 94 190 60 220 52 C250 44 270 30 310 14"/>
      <circle class="dot" cx="310" cy="14" r="7"/>
    </svg>
    <p class="caption">${esc(c.caption)}</p>`,

  open: (c) => `${head(c)}${paras(c.paras)}
    <div class="voice in" style="--i:5" id="voice"><span class="play"></span>
      <span class="wave">${Array.from({ length: 28 }, (_, i) => `<i style="--h:${25 + Math.round(70 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)))};--d:${(i % 7) / 10}"></i>`).join('')}</span>
      <time>4:56</time></div>
    <p class="note in" style="--i:6">${esc(c.voice)}</p>`,

  away: (c) => `${head(c)}${paras(c.paras)}
    <svg class="route in" style="--i:5" viewBox="0 0 320 130">
      <path id="rt" class="path" d="M40 92 C100 20 200 130 280 44"/>
      <circle cx="40" cy="92" r="9" fill="#7c5cff"/><circle cx="280" cy="44" r="12" fill="#ff7a1a"/><circle cx="280" cy="44" r="4" fill="#fff"/>
      <text class="pin" x="40" y="120" text-anchor="middle">Home court</text>
      <text class="pin" x="300" y="20" text-anchor="end">States</text>
      <g><circle r="8" fill="#ff7a1a"/><path d="M-8 0h16M0-8v16" stroke="#3a2418" stroke-width="1.4"/>
        <animateMotion dur="3.2s" repeatCount="indefinite" rotate="auto"><mpath href="#rt"/></animateMotion></g>
    </svg>
    <p class="kick in" style="--i:6">${esc(c.kicker)}</p>`,
};

function mountTradingCards(body) {
  body.querySelectorAll('[data-card]').forEach((card) => {
    let down = null, touched = 0;
    const tilt = (x, y) => {
      card.style.setProperty('--ry', `${x * 22}deg`); card.style.setProperty('--rx', `${-y * 18}deg`);
      card.style.setProperty('--mx', `${50 + x * 100}%`); card.style.setProperty('--my', `${50 + y * 100}%`);
    };
    const at = (e) => {
      const r = card.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5];
    };
    card.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; touched = performance.now(); tilt(...at(e)); });
    card.addEventListener('pointermove', (e) => { touched = performance.now(); tilt(...at(e)); });
    card.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 10) { card.classList.toggle('flipped'); sfx.whoosh(); }
      down = null;
    });
    // gentle idle sway so the foil keeps catching light
    const idle = (t) => {
      if (!card.isConnected) return;
      if (performance.now() - touched > 1500) tilt(Math.sin(t / 1400) * 0.35, Math.cos(t / 1900) * 0.25);
      requestAnimationFrame(idle);
    };
    requestAnimationFrame(idle);
  });
}

function mountCard(body) {
  mountTradingCards(body);
  const voice = body.querySelector('#voice');
  if (voice) {
    let timer;
    voice.onclick = () => {
      sfx.tap();
      const bars = [...voice.querySelectorAll('.wave i')];
      if (voice.classList.toggle('playing')) {
        let k = 0, s = 0;
        timer = setInterval(() => {
          bars.forEach((b, i) => b.classList.toggle('lit', i < k));
          const sec = Math.round((k / bars.length) * 296);
          voice.querySelector('time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
          if (++s % 2 === 0) k = (k + 1) % (bars.length + 1);
        }, 120);
      } else clearInterval(timer);
    };
  }
}

function openCard(i) {
  const c = C.cards[i];
  sfx.chime();
  return sheet(RENDER[c.type](c), { button: i + 1 < TOTAL() ? 'Back to the court' : 'Hear the buzzer', onMount: mountCard });
}

// ---------- finale ----------
const DISPLAY = 'Anton, Impact, sans-serif';

function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function drawBall(g, x, y, r) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, '#ffc08a'); gr.addColorStop(0.55, '#ff7a1a'); gr.addColorStop(1, '#a8400a');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.save(); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
  g.strokeStyle = '#2b160a'; g.lineWidth = r * 0.05;
  g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
  g.beginPath(); g.ellipse(x - r * 1.05, y, r * 0.62, r * 1.05, 0, -Math.PI / 2, Math.PI / 2); g.stroke();
  g.beginPath(); g.ellipse(x + r * 1.05, y, r * 0.62, r * 1.05, 0, Math.PI / 2, Math.PI * 1.5); g.stroke();
  g.restore();
}

const firstDate = (opts) => new Date(P.first || Date.now()).toLocaleDateString(undefined, opts);

function mvpCanvas() {
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1a1150'); bg.addColorStop(0.6, '#0a0722'); bg.addColorStop(1, '#05040f');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  [[200, 260, 460, 'rgba(124,92,255,0.45)'], [900, 420, 420, 'rgba(255,122,26,0.4)'], [540, 1200, 520, 'rgba(255,201,77,0.18)']].forEach(([x, y, r, col]) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  });
  g.save(); g.translate(W / 2, 470); g.globalAlpha = 0.18;
  for (let i = 0; i < 36; i++) { g.rotate(Math.PI / 18); g.fillStyle = i % 2 ? '#ff7a1a' : '#7c5cff'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-40, -900); g.lineTo(40, -900); g.fill(); }
  g.restore();
  const frame = g.createLinearGradient(0, 0, W, H);
  frame.addColorStop(0, '#fff2c2'); frame.addColorStop(0.3, '#d8a632'); frame.addColorStop(0.5, '#fff6d6'); frame.addColorStop(0.7, '#b8861c'); frame.addColorStop(1, '#ffe7a0');
  rr(g, 60, 60, W - 120, H - 120, 56); g.lineWidth = 14; g.strokeStyle = frame; g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#ffc94d'; g.font = `44px ${DISPLAY}`;
  g.fillText('SURPRISE  #1', W / 2, 190);
  drawBall(g, W / 2, 440, 160);
  const mv = g.createLinearGradient(0, 640, 0, 860);
  mv.addColorStop(0, '#fff'); mv.addColorStop(0.5, '#ffb06b'); mv.addColorStop(1, '#ff7a1a');
  g.fillStyle = mv; g.font = `250px ${DISPLAY}`;
  g.shadowColor = 'rgba(255,122,26,0.6)'; g.shadowBlur = 40;
  g.fillText('MVP', W / 2, 870);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff'; g.font = `130px ${DISPLAY}`;
  g.fillText(C.name.toUpperCase(), W / 2, 1020);
  g.fillStyle = '#c9b8ff'; g.font = `42px ${DISPLAY}`;
  g.fillText(`#${C.number}  ·  FRANCHISE PLAYER`, W / 2, 1090);
  g.fillStyle = '#8f87b3'; g.font = '600 34px -apple-system, system-ui, sans-serif';
  g.fillText(`First opened ${firstDate({ day: 'numeric', month: 'long', year: 'numeric' })}`, W / 2, 1180);
  return c;
}

async function saveCard(canvas) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], 'mvp-card.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch { /* she closed the share sheet */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'mvp-card.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const MEDAL = `<svg class="medal" viewBox="0 0 160 230" aria-hidden="true">
  <defs>
    <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c2"/><stop offset="0.35" stop-color="#e2ae38"/><stop offset="0.55" stop-color="#fff6d6"/><stop offset="0.8" stop-color="#b8861c"/><stop offset="1" stop-color="#ffe7a0"/></linearGradient>
    <linearGradient id="mg2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a0"/><stop offset="1" stop-color="#a87412"/></linearGradient>
  </defs>
  <path d="M38 0 L72 0 L92 96 L64 104Z" fill="#7c5cff"/><path d="M122 0 L88 0 L68 96 L96 104Z" fill="#ff7a1a"/>
  <path d="M48 0 L62 0 L80 86 L72 90Z" fill="#fff" opacity="0.25"/>
  <circle cx="80" cy="156" r="66" fill="url(#mg)"/>
  <circle cx="80" cy="156" r="52" fill="url(#mg2)"/>
  <circle cx="80" cy="156" r="52" fill="none" stroke="#fff6d6" stroke-width="2" opacity="0.7"/>
  <text x="80" y="148" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="30" fill="#4a2c00">MVP</text>
  <text x="80" y="180" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="18" fill="#4a2c00" letter-spacing="2">SURPRISE #1</text>
</svg>`;

function finaleHtml(cv) {
  const f = C.finale;
  return `${MEDAL}<p class="eyebrow in" style="text-align:center">Final buzzer</p><h2 class="in" style="--i:1;text-align:center">${esc(f.title)}</h2>
    <p class="in" style="--i:2;text-align:center"><span class="date-stamp">${esc(firstDate({ day: 'numeric', month: 'short', year: 'numeric' }))}</span></p>
    <p class="lead in" style="--i:3;margin-top:18px">${esc(f.lead)}</p>
    ${paras(f.paras, 4)}
    <p class="hinglish in" style="--i:6">${esc(f.line)}</p>
    <img class="mvp-img" src="${cv.toDataURL('image/png')}" alt="Your MVP card">
    <div class="row in" style="--i:7"><button class="btn glass small" id="saveCard"><span>Save your MVP card</span></button></div>
    <p class="sign in" style="--i:8">${esc(f.sign)}<b>${esc(C.from)}</b></p>`;
}

async function finale() {
  court.shooting = false;
  hide($('#hud'));
  sfx.buzzer();
  court.setScore(P.n, 'FINAL · MVP');
  await sleep(900);
  sfx.cheer(4.5, 1.2);
  court.celebrate(true);
  setTimeout(() => court.celebrate(true), 800);
  court.reveal();
  P.done = true; save();
  await sleep(1600);
  const cv = mvpCanvas();
  await sheet(finaleHtml(cv), {
    button: 'Open your locker',
    onMount: (b) => { b.querySelector('#saveCard').onclick = () => { sfx.tap(); saveCard(cv); }; },
  });
  locker();
}

// ---------- locker ----------
const ICONS = {
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5c2 2.5 6 2.5 8 0M9 9.5h.01M15 9.5h.01"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2.5"/><path d="M22 11v2M6.5 10.5v3"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  loop: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>',
};
const TINTS = ['rgba(124,92,255,0.35)', 'rgba(255,122,26,0.3)', 'rgba(255,201,77,0.22)', 'rgba(63,208,201,0.25)', 'rgba(255,79,109,0.25)'];

function locker() {
  mode = 'locker';
  court.toLocker();
  court.setScore(P.n, 'LOCKER ROOM');
  hide($('#hud'));
  const g = $('#grid');
  g.innerHTML = C.openWhen.map((o, i) => `
    <button class="tile${P.seen.includes(o.id) ? '' : ' new'}" style="--i:${i};--tint:${TINTS[i % TINTS.length]}" data-id="${o.id}">
      <span class="ic"><svg viewBox="0 0 24 24">${ICONS[o.icon] || ICONS.spark}</svg></span>
      <span><small>Open when</small><b>${esc(o.label)}</b></span>
    </button>`).join('');
  show($('#locker'));
  $('#locker').scrollTop = 0;
  g.onclick = (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    sfx.tap();
    if (!P.seen.includes(t.dataset.id)) { P.seen.push(t.dataset.id); save(); t.classList.remove('new'); }
    openWhen(C.openWhen.find((o) => o.id === t.dataset.id));
  };
  $('#cardsAgain').onclick = () => {
    sfx.tap();
    const cards = C.cards.filter((c) => c.type === 'player' || c.type === 'persona');
    sheet(cards.map((c) => `<p class="eyebrow">${esc(c.eyebrow)}</p>${tradingCard(c, c.type === 'player' ? C.action : BUST, c.type === 'persona')}`).join(''),
      { button: 'Back to the locker', onMount: mountTradingCards });
  };
  $('#mvpAgain').onclick = () => {
    sfx.tap();
    const cv = mvpCanvas();
    sheet(finaleHtml(cv), { button: 'Back to the locker', onMount: (b) => { b.querySelector('#saveCard').onclick = () => saveCard(cv); } });
  };
  $('#replay').onclick = async () => {
    sfx.tap();
    P.n = 0; P.done = false; save();
    court.setScore(0);
    hide($('#locker'));
    ['#kicker', '#line1', '#star', '#line2', '#line3'].forEach((s) => { $(s).textContent = ''; $(s).classList.remove('on'); });
    $('#dragHint').classList.remove('on');
    hide($('#takeCourt'));
    intro();
  };
}

const WIDGETS = {
  breathe: () => '<div class="breathe"><div class="bb"></div></div><p class="caption" id="breathLabel" style="font-size:18px">Breathe in…</p>',
  questions: (o) => `<div class="qcard" id="qcard">${esc(o.questions[0])}</div><div class="row"><button class="btn glass small" id="nextQ"><span>Another one</span></button></div>`,
  freeplay: () => '<div class="row"><button class="btn primary" id="freeplay"><span>Shoot around</span></button></div>',
  charge: () => '<div class="big-batt"><span class="batt"><i></i></span></div>',
  report: () => '<div class="row"><button class="btn primary" id="report"><span>Open the scouting report</span></button></div>',
};

function openWhen(o) {
  const links = o.links ? `<div class="links">${o.links.map(([t, u]) =>
    `<a class="link in" style="--i:4" href="${esc(u)}" target="_blank" rel="noopener noreferrer"><i></i><span>${esc(t)}</span><em>↗</em></a>`).join('')}</div>` : '';
  const html = `<p class="eyebrow in">Open when ${esc(o.label)}</p><h2 class="in" style="--i:1">${esc(o.title)}</h2>${paras(o.paras)}${links}${o.widget ? WIDGETS[o.widget](o) : ''}`;
  let timer;
  sheet(html, {
    button: 'Back to the locker',
    onMount: (b) => {
      if (o.widget === 'breathe') {
        const steps = ['Breathe in…', 'Hold…', 'Breathe out…', 'Hold…'];
        let k = 0;
        timer = setInterval(() => { k = (k + 1) % 4; const l = b.querySelector('#breathLabel'); if (l) l.textContent = steps[k]; }, 4000);
      }
      if (o.widget === 'questions') {
        let k = 0;
        b.querySelector('#nextQ').onclick = () => {
          sfx.tap();
          k = (k + 1) % o.questions.length;
          const q = b.querySelector('#qcard');
          q.textContent = o.questions[k];
          q.classList.remove('flip'); void q.offsetWidth; q.classList.add('flip');
        };
      }
      if (o.widget === 'freeplay') {
        b.querySelector('#freeplay').onclick = () => { $('#sheetClose').click(); hide($('#locker')); game(true); };
      }
      if (o.widget === 'report') {
        b.querySelector('#report').onclick = async () => {
          $('#sheetClose').click();
          await sleep(400);
          const c = C.cards.find((x) => x.type === 'list');
          sheet(RENDER.list(c), { button: 'Back to the locker', onMount: mountCard });
        };
      }
    },
  }).then(() => clearInterval(timer));
}
