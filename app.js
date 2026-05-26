/* ChapCam — app.js */

const { createClient } = supabase;
const BUCKET = CHAPCAM_CONFIG.bucketName;

const isConfigured =
  CHAPCAM_CONFIG.supabaseUrl !== 'YOUR_SUPABASE_URL_HERE' &&
  CHAPCAM_CONFIG.supabaseAnonKey !== 'YOUR_SUPABASE_ANON_KEY_HERE';

const sb = isConfigured
  ? createClient(CHAPCAM_CONFIG.supabaseUrl, CHAPCAM_CONFIG.supabaseAnonKey)
  : null;

/* ── Session ID (persists per device, used to identify own photos) ── */
function getSessionId() {
  let id = localStorage.getItem('chapcam_session');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem('chapcam_session', id);
  }
  return id;
}

/* ── State ── */
let stream     = null;
let facingMode = 'environment';
let capturedBlob = null;
let grainRAF   = null;

/* ── Screen routing ── */

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setOverlay(on) {
  document.getElementById('overlay').classList.toggle('hidden', !on);
}

/* ── Camera ── */

async function startCamera() {
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false
    });
    const v = document.getElementById('video');
    v.srcObject = stream;
    await v.play();
    runGrain();
    updateFilmCounter();
  } catch {
    alert('Camera access needed. In Safari: Settings → Safari → Camera → Allow.');
  }
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  if (grainRAF) { cancelAnimationFrame(grainRAF); grainRAF = null; }
}

function runGrain() {
  const canvas = document.getElementById('grain-canvas');
  const ctx = canvas.getContext('2d');
  function frame() {
    const v = document.getElementById('video');
    if (!v.videoWidth) { grainRAF = requestAnimationFrame(frame); return; }
    canvas.width  = v.clientWidth;
    canvas.height = v.clientHeight;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() * 255) | 0;
      d[i] = d[i+1] = d[i+2] = n;
      d[i+3] = (Math.random() * 38) | 0;
    }
    ctx.putImageData(img, 0, 0);
    grainRAF = requestAnimationFrame(frame);
  }
  grainRAF = requestAnimationFrame(frame);
}

async function updateFilmCounter() {
  if (!isConfigured) return;
  try {
    const { data } = await sb.storage.from(BUCKET).list('', { limit: 1000 });
    const n = data?.length ?? 0;
    document.getElementById('film-counter').textContent =
      String(n).padStart(3, '0') + ' shots';
  } catch {}
}

/* ── Capture ── */

function doCapture() {
  const video = document.getElementById('video');
  if (!video.videoWidth) return;

  const flash = document.getElementById('flash');
  flash.classList.add('on');
  setTimeout(() => flash.classList.remove('on'), 130);
  shutterSound();

  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (facingMode === 'user') {
    ctx.translate(w, 0); ctx.scale(-1, 1);
  }

  ctx.filter = 'saturate(0.72) contrast(1.08) sepia(0.2)';
  ctx.drawImage(video, 0, 0, w, h);
  ctx.filter = 'none';
  addGrain(ctx, w, h);

  capturedBlob = null;
  canvas.toBlob(b => { capturedBlob = b; }, 'image/jpeg', 0.88);
  document.getElementById('preview-img').src = canvas.toDataURL('image/jpeg', 0.88);

  stopCamera();
  show('screen-preview');
}

function addGrain(ctx, w, h) {
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const g = tmp.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() * 255) | 0;
    d[i] = d[i+1] = d[i+2] = n; d[i+3] = 20;
  }
  g.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.17;
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(tmp, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function shutterSound() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.frequency.setValueAtTime(1100, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(280, ac.currentTime + 0.07);
    gain.gain.setValueAtTime(0.22, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09);
    osc.start(); osc.stop(ac.currentTime + 0.09);
  } catch {}
}

/* ── Upload ── */

async function usePhoto() {
  if (!isConfigured) { alert('Supabase not configured yet — see config.js.'); return; }
  if (!capturedBlob) {
    alert('Photo still processing — wait a moment and try again.');
    return;
  }
  const btn = document.getElementById('use-btn');
  btn.disabled = true;
  setOverlay(true);

  const name = `${Date.now()}-${getSessionId()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(name, capturedBlob, { contentType: 'image/jpeg', upsert: false });

  setOverlay(false);
  btn.disabled = false;

  if (error) {
    alert('Upload failed: ' + error.message);
    return;
  }
  openFeed();
}

/* ── Feed ── */

async function openFeed() {
  show('screen-feed');
  const grid = document.getElementById('feed-grid');
  if (!isConfigured) {
    grid.innerHTML = '<p class="empty-state">Supabase not set up yet.<br>Fill in config.js to see photos.</p>';
    return;
  }
  grid.innerHTML = '<p class="empty-state">Loading photos…</p>';

  const { data, error } = await sb.storage
    .from(BUCKET)
    .list('', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });

  if (error || !data?.length) {
    grid.innerHTML = '<p class="empty-state">No photos yet.<br>Be the first to shoot! 📷</p>';
    return;
  }

  grid.innerHTML = '';
  const mySession = getSessionId();
  data.forEach(file => {
    grid.appendChild(makePolaroid(file, mySession, false));
  });
}

function makePolaroid(file, mySession, isAdmin) {
  const { data: u } = sb.storage.from(BUCKET).getPublicUrl(file.name);
  const div = document.createElement('div');
  div.className = 'feed-polaroid';

  const img = document.createElement('img');
  img.src = u.publicUrl; img.loading = 'lazy';
  div.appendChild(img);

  // filename format: {timestamp}-{sessionId}-{random}.jpg
  const parts = file.name.split('-');
  const photoSession = parts.length >= 3 ? parts[1] : null;
  const isOwner = photoSession && photoSession === mySession;

  if (isOwner || isAdmin) {
    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.title = 'Remove photo';
    btn.textContent = '✕';
    btn.onclick = e => { e.stopPropagation(); deletePhoto(file.name, div); };
    div.appendChild(btn);
  }

  return div;
}

async function deletePhoto(filename, element) {
  if (!confirm('Remove this photo?')) return;
  const { error } = await sb.storage.from(BUCKET).remove([filename]);
  if (error) { alert('Could not remove: ' + error.message); return; }
  element.remove();
}

/* ── Admin ── */

async function loadAdminPanel() {
  if (!isConfigured) { document.getElementById('admin-stats').textContent = 'Not connected yet.'; return; }
  const { data } = await sb.storage.from(BUCKET).list('', { limit: 1000 });
  const count = data?.length ?? 0;
  document.getElementById('admin-stats').textContent =
    `${count} photo${count !== 1 ? 's' : ''} in the album`;

  const grid = document.getElementById('admin-grid');
  grid.innerHTML = '';
  data?.forEach(file => {
    grid.appendChild(makePolaroid(file, null, true));
  });
}

async function downloadAll() {
  if (!isConfigured) { alert('Supabase not configured yet.'); return; }
  const btn = document.getElementById('download-btn');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  const { data } = await sb.storage.from(BUCKET).list('', { limit: 1000 });
  if (!data?.length) {
    alert('No photos to download yet.');
    btn.disabled = false; btn.textContent = 'Download All Photos';
    return;
  }

  const zip = new JSZip();
  let done = 0;
  await Promise.all(data.map(async (file, i) => {
    const { data: u } = sb.storage.from(BUCKET).getPublicUrl(file.name);
    try {
      const res = await fetch(u.publicUrl);
      const blob = await res.blob();
      zip.file(`chapcam_${String(i + 1).padStart(3, '0')}.jpg`, blob);
    } catch {}
    done++;
    btn.textContent = `Packing ${done}/${data.length}…`;
  }));

  const zipBlob = await zip.generateAsync({ type: 'blob' }, meta => {
    btn.textContent = `Zipping ${Math.round(meta.percent)}%…`;
  });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(zipBlob);
  a.download = 'chapcam_wedding.zip';
  a.click();
  URL.revokeObjectURL(a.href);

  btn.disabled = false;
  btn.textContent = 'Download All Photos';
}

/* ── Event wiring ── */

document.addEventListener('DOMContentLoaded', () => {
  // Welcome
  document.getElementById('start-btn').onclick = () => {
    show('screen-camera'); startCamera();
  };
  document.getElementById('feed-btn').onclick = openFeed;

  // Camera
  document.getElementById('shutter').onclick   = doCapture;
  document.getElementById('feed-link').onclick = () => { stopCamera(); openFeed(); };
  document.getElementById('flip-btn').onclick  = () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
  };

  // Preview
  document.getElementById('retake-btn').onclick = () => {
    show('screen-camera'); startCamera();
  };
  document.getElementById('use-btn').onclick = usePhoto;

  // Feed
  document.getElementById('back-to-cam').onclick = () => {
    show('screen-camera'); startCamera();
  };

  // Admin
  document.getElementById('admin-home').onclick   = () => show('screen-welcome');
  document.getElementById('download-btn').onclick = downloadAll;

  // Route: #admin loads the album download page
  if (window.location.hash === '#admin') {
    show('screen-admin');
    loadAdminPanel();
  }
});
