import { tracks } from './tracks.js';

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const box = $('boombox');
const shelf = $('tape-shelf');
const seek = $('seek');
const volume = $('volume');
let current = 0;
let ejected = true;
let expanded = false;
let requestId = 0;
let lastVolume = .75;
let seeking = false;
let meterTimer = null;
const meterFills = [...document.querySelectorAll('.meter-fill')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Playback-responsive decorative meters: the existing audio origin does not
// allow cross-origin Web Audio analysis. Never route it into a silent analyser.
function updateMeters() {
  const active = !audio.paused && !audio.ended && !ejected && audio.readyState >= 3 && !box.classList.contains('is-buffering');
  const gain = audio.muted ? 0 : audio.volume;
  const draw = () => {
    const base = reducedMotion.matches ? .55 : .3 + Math.random() * .6;
    meterFills.forEach((fill) => {
      const level = active ? Math.min(1, base + (reducedMotion.matches ? 0 : (Math.random() - .5) * .24)) * gain : 0;
      fill.style.width = `${Math.round(level * 100)}%`;
    });
  };
  clearInterval(meterTimer);
  meterTimer = null;
  draw();
  if (active && gain > 0 && !reducedMotion.matches) meterTimer = setInterval(draw, 125);
}
reducedMotion.addEventListener('change', updateMeters);
const colors = [
  ['#e1d8b8','#df683b'], ['#c7d0c4','#537e78'], ['#e0bdad','#bd4c40'],
  ['#c0c9df','#65629a'], ['#dbcda8','#c49a36'], ['#ccd2ac','#7f9351'],
];

function time(seconds) {
  if (!Number.isFinite(seconds)) return '—:—';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

function status(message) { $('status').textContent = message; }

function currentChapters() { return ejected ? [] : tracks[current].chapters || []; }
function chapterIndex() {
  const chapters = currentChapters();
  let index = 0;
  for (let i = 1; i < chapters.length; i++) {
    if (audio.currentTime + .05 < chapters[i].startSeconds) break;
    index = i;
  }
  return index;
}
function renderChapters() {
  const chapters = currentChapters();
  $('chapter-control').hidden = !chapters.length;
  $('chapter-select').replaceChildren(...chapters.map((chapter, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${index + 1}. ${chapter.title}`;
    return option;
  }));
  for (const [id, label] of [['previous', 'Previous'], ['next', 'Next']]) {
    $(id).setAttribute('aria-label', `${label} ${chapters.length ? 'track' : 'tape'}`);
    $(id).title = `${label} ${chapters.length ? 'track' : 'tape'}`;
  }
}
function seekChapter(index) {
  const chapter = currentChapters()[index];
  if (!chapter || !Number.isFinite(audio.duration)) return false;
  audio.currentTime = Math.min(chapter.startSeconds, audio.duration);
  updateProgress();
  return true;
}
function moveTrack(direction) {
  if (ejected) return loadTape(current, true);
  const chapters = currentChapters();
  if (chapters.length) {
    const index = chapterIndex();
    const target = direction < 0 && audio.currentTime - chapters[index].startSeconds > 3 ? index : index + direction;
    if (target >= 0 && target < chapters.length) {
      if (seekChapter(target)) return startPlayback();
      return;
    }
  }
  return loadTape(current + direction, true);
}
$('chapter-select').addEventListener('change', () => seekChapter(Number($('chapter-select').value)));

function drawShelf() {
  const fragment = document.createDocumentFragment();
  for (const [i, track] of tracks.entries()) {
    const item = document.createElement('li');
    item.hidden = !expanded && i >= 12 && (i !== current || ejected);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tape-card';
    button.setAttribute('aria-label', `Load and play tape ${track.id}: ${track.title}${track.artist ? ` by ${track.artist}` : ''}`);
    button.setAttribute('aria-pressed', String(i === current && !ejected));
    button.style.setProperty('--tape-color', colors[i % colors.length][0]);
    button.style.setProperty('--tape-accent', colors[i % colors.length][1]);
    // All varying text is assigned with textContent, never interpreted as HTML.
    button.innerHTML = '<div class="case-spine"><span class="spine-number"></span><span class="spine-label"><span class="spine-title"></span><span class="spine-artist"></span></span><span class="spine-format" aria-hidden="true">STEREO</span></div>';
    button.querySelector('.spine-number').textContent = String(track.id).padStart(2, '0');
    button.querySelector('.spine-title').textContent = track.title;
    button.querySelector('.spine-artist').textContent = track.artist || 'Unknown artist';
    button.title = track.title + ' — ' + (track.artist || 'Unknown artist');
    if (i === current && !ejected) {
      const marker = document.createElement('span');
      marker.className = 'loaded-marker';
      marker.textContent = 'IN DECK';
      button.append(marker);
    }
    button.addEventListener('click', () => loadTape(i, true));
    item.append(button);
    fragment.append(item);
  }
  shelf.replaceChildren(fragment);
}

function updateShelfSelection() {
  // Keep existing buttons mounted so keyboard focus survives a selection.
  Array.from(shelf.children).forEach((item, i) => {
    item.hidden = !expanded && i >= 12 && (i !== current || ejected);
    const button = item.firstElementChild;
    const selected = i === current && !ejected;
    button.setAttribute('aria-pressed', String(selected));
    let marker = button.querySelector('.loaded-marker');
    if (selected && !marker) {
      marker = document.createElement('span');
      marker.className = 'loaded-marker';
      marker.textContent = 'IN DECK';
      button.append(marker);
    } else if (!selected) marker?.remove();
  });
}

function updateProgress() {
  const duration = audio.duration;
  const position = audio.currentTime || 0;
  const knownDuration = !ejected && Number.isFinite(duration) && duration > 0;
  seek.disabled = !knownDuration;
  $('chapter-select').disabled = !knownDuration;
  if (currentChapters().length) $('chapter-select').selectedIndex = chapterIndex();
  if (!seeking) {
    const fraction = knownDuration ? position / duration : 0;
    seek.value = String(Math.round(fraction * 1000));
    seek.style.setProperty('--progress', `${fraction * 100}%`);
    seek.setAttribute('aria-valuetext', `${time(position)} of ${knownDuration ? time(duration) : 'unknown duration'}`);
    box.style.setProperty('--supply', String(1.2 - fraction * .6));
    box.style.setProperty('--takeup', String(.6 + fraction * .6));
  }
  $('elapsed').textContent = time(ejected ? 0 : position);
  $('duration').textContent = knownDuration ? time(duration) : '—:—';
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try {
      if (knownDuration) navigator.mediaSession.setPositionState({ duration, playbackRate: audio.playbackRate, position: Math.min(position, duration) });
      else navigator.mediaSession.setPositionState();
    } catch { /* Older browsers can reject position updates while changing source. */ }
  }
}

function updatePlayback() {
  const playing = !audio.paused && !audio.ended && !ejected;
  $('player-heading').classList.toggle('is-empty', ejected);
  $('playback-state').hidden = ejected;
  $('playback-timeline').hidden = ejected;
  $('loaded-tape').setAttribute('aria-hidden', String(ejected));
  box.classList.toggle('is-playing', playing);
  $('play').classList.toggle('is-active', playing);
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('play-label').textContent = playing ? 'PAUSE' : 'PLAY';
  $('play-icon').textContent = playing ? 'Ⅱ' : '▶';
  $('power-label').textContent = playing ? 'PLAYING' : 'STANDBY';
  $('playback-state').textContent = ejected ? 'DECK EMPTY' : `${playing ? 'NOW PLAYING' : audio.currentTime ? 'PAUSED' : 'READY TO PLAY'} · TAPE ${String(current + 1).padStart(2, '0')}`;
  for (const id of ['rewind', 'forward', 'eject']) $(id).disabled = ejected;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = ejected ? 'none' : playing ? 'playing' : 'paused';
  updateMeters();
}

async function startPlayback() {
  if (ejected) return loadTape(current, true);
  const attempt = ++requestId;
  if (audio.error) audio.load();
  status('Starting the tape…');
  try {
    await audio.play();
    if (attempt !== requestId) return false;
    status('Tape rolling.');
    return true;
  } catch (error) {
    if (attempt !== requestId || error.name === 'AbortError') return false;
    box.classList.remove('is-buffering');
    status(error.name === 'NotAllowedError' ? 'Press play to allow audio in this browser.' : 'This tape could not play. Try again or choose another tape.');
    updatePlayback();
    return false;
  }
}

function loadTape(index, play = false) {
  requestId++;
  audio.pause();
  current = ((index % tracks.length) + tracks.length) % tracks.length;
  ejected = false;
  box.classList.remove('is-ejected', 'is-buffering');
  const track = tracks[current];
  $('tape-title').textContent = track.title;
  $('tape-artist').textContent = track.artist || 'MIXTAPE';
  document.querySelector('.tape-type').textContent = `MIX / ${String(track.id).padStart(2, '0')}`;
  $('loaded-tape').setAttribute('aria-label', `Loaded cassette: ${track.title}`);
  $('now-title').textContent = track.title;
  $('now-artist').textContent = track.artist || 'DJ mix';
  document.title = `${track.title} — Mixtape`;
  audio.src = track.url;
  audio.load();
  renderChapters();
  updateShelfSelection();
  updateProgress();
  updatePlayback();
  status('Tape loaded. Press play.');
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: 'Mixtape' });
  }
  return play ? startPlayback() : Promise.resolve(true);
}

function pausePlayback() {
  requestId++;
  audio.pause();
  box.classList.remove('is-buffering');
  status('Tape paused.');
  updatePlayback();
}

function togglePlayback() { return audio.paused || ejected ? startPlayback() : pausePlayback(); }

function skip(seconds) {
  if (ejected || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
  updateProgress();
}

function ejectTape() {
  requestId++;
  audio.pause();
  ejected = true;
  audio.removeAttribute('src');
  audio.load();
  box.classList.add('is-ejected');
  box.classList.remove('is-buffering');
  $('now-title').textContent = 'Long live the mixtape.';
  $('now-artist').textContent = 'Pick a tape. Press play. Stay a while.';
  document.title = 'Mixtape — Press play.';
  status('Tape ejected. Pick a tape, or press play to reload.');
  renderChapters();
  updateShelfSelection();
  updateProgress();
  updatePlayback();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

function syncVolume() {
  const silent = audio.muted || audio.volume === 0;
  $('mute').setAttribute('aria-pressed', String(silent));
  $('mute').setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
  const value = audio.muted ? 0 : Math.round(audio.volume * 100);
  volume.setAttribute('aria-valuenow', String(value));
  volume.setAttribute('aria-valuetext', `${value}%${audio.muted ? ', muted' : ''}`);
  volume.style.setProperty('--knob-angle', `${-135 + value * 2.7}deg`);
  $('volume-value').textContent = `${value}%`;
  updateMeters();
}

function setVolume(value) {
  audio.volume = Math.max(0, Math.min(100, value)) / 100;
  audio.muted = false;
  if (audio.volume > 0) lastVolume = audio.volume;
  syncVolume();
}

let dialDrag = null;
function pointerAngle(event) {
  const rect = volume.getBoundingClientRect();
  return Math.atan2(event.clientX - rect.left - rect.width / 2, rect.top + rect.height / 2 - event.clientY) * 180 / Math.PI;
}
volume.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || dialDrag) return;
  event.preventDefault();
  volume.focus();
  volume.setPointerCapture(event.pointerId);
  const rect = volume.getBoundingClientRect();
  const distance = Math.hypot(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  dialDrag = { id: event.pointerId, angle: pointerAngle(event), y: event.clientY, linear: distance < rect.width * .2, value: audio.muted ? 0 : audio.volume * 100 };
  volume.classList.add('is-dragging');
});
volume.addEventListener('pointermove', (event) => {
  if (!dialDrag || event.pointerId !== dialDrag.id) return;
  const angle = pointerAngle(event);
  let delta = angle - dialDrag.angle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  dialDrag.value = Math.max(0, Math.min(100, dialDrag.value + (dialDrag.linear ? (dialDrag.y - event.clientY) * .7 : delta / 2.7)));
  dialDrag.angle = angle;
  dialDrag.y = event.clientY;
  setVolume(dialDrag.value);
});
function finishDialDrag() { dialDrag = null; volume.classList.remove('is-dragging'); }
volume.addEventListener('pointerup', finishDialDrag);
volume.addEventListener('pointercancel', finishDialDrag);
volume.addEventListener('lostpointercapture', finishDialDrag);
volume.addEventListener('keydown', (event) => {
  const value = audio.muted ? 0 : audio.volume * 100;
  const values = { ArrowUp: value + 2, ArrowRight: value + 2, ArrowDown: value - 2, ArrowLeft: value - 2, PageUp: value + 10, PageDown: value - 10, Home: 0, End: 100 };
  if (!(event.key in values)) return;
  event.preventDefault();
  event.stopPropagation();
  setVolume(values[event.key]);
});

$('play').addEventListener('click', togglePlayback);
$('previous').addEventListener('click', () => moveTrack(-1));
$('next').addEventListener('click', () => moveTrack(1));
$('rewind').addEventListener('click', () => skip(-15));
$('forward').addEventListener('click', () => skip(15));
$('eject').addEventListener('click', ejectTape);
$('mute').addEventListener('click', () => {
  if (audio.volume === 0) { audio.volume = lastVolume; audio.muted = false; }
  else audio.muted = !audio.muted;
  syncVolume();
});
seek.addEventListener('input', () => {
  if (!Number.isFinite(audio.duration)) return;
  seeking = true;
  const fraction = Number(seek.value) / 1000;
  seek.style.setProperty('--progress', `${fraction * 100}%`);
  $('elapsed').textContent = time(fraction * audio.duration);
  seek.setAttribute('aria-valuetext', `${time(fraction * audio.duration)} of ${time(audio.duration)}`);
});
seek.addEventListener('change', () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value) / 1000 * audio.duration;
  seeking = false;
  updateProgress();
});
seek.addEventListener('blur', () => { seeking = false; updateProgress(); });
$('show-all').addEventListener('click', () => {
  expanded = !expanded;
  updateShelfSelection();
  $('show-all').setAttribute('aria-expanded', String(expanded));
  $('show-all').innerHTML = expanded ? 'Show fewer tapes <span aria-hidden="true">↑</span>' : `View all ${tracks.length} tapes <span aria-hidden="true">↓</span>`;
});

audio.addEventListener('playing', () => { box.classList.remove('is-buffering'); updatePlayback(); status('Tape rolling.'); });
audio.addEventListener('play', updatePlayback);
audio.addEventListener('pause', updatePlayback);
audio.addEventListener('waiting', () => {
  if (!audio.paused && !ejected) { box.classList.add('is-buffering'); updateMeters(); status('Buffering the tape…'); }
});
audio.addEventListener('canplay', () => { box.classList.remove('is-buffering'); updateMeters(); });
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', updateProgress);
audio.addEventListener('durationchange', updateProgress);
audio.addEventListener('volumechange', syncVolume);
audio.addEventListener('ended', () => loadTape(current + 1, true));
audio.addEventListener('error', () => {
  if (ejected) return;
  box.classList.remove('is-buffering', 'is-playing');
  audio.pause();
  status('This tape is unavailable. Try another cassette or check your connection.');
  updatePlayback();
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.target.closest('button, input, textarea, select, a, [role="slider"], [contenteditable="true"]')) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
  else if (event.code === 'ArrowLeft') { event.preventDefault(); skip(-15); }
  else if (event.code === 'ArrowRight') { event.preventDefault(); skip(15); }
});

if ('mediaSession' in navigator) {
  const actions = {
    play: startPlayback, pause: pausePlayback,
    previoustrack: () => moveTrack(-1), nexttrack: () => moveTrack(1),
    seekbackward: (details) => skip(-(details.seekOffset || 15)),
    seekforward: (details) => skip(details.seekOffset || 15),
    seekto: (details) => {
      if (!ejected && Number.isFinite(details.seekTime) && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime));
        updateProgress();
      }
    },
    stop: ejectTape,
  };
  for (const [action, handler] of Object.entries(actions)) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Action not supported. */ }
  }
}

drawShelf();
$('tape-count').textContent = String(tracks.length);
$('show-all').hidden = tracks.length <= 12;
audio.volume = .75;
syncVolume();
updateProgress();
updatePlayback();
status('Pick a tape from the shelf, or press play to load the first tape.');

// Optional agent controls, sharing the exact actions used by the visible player.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tools = [{
    name: 'list_mixtapes', title: 'List mixtapes',
    description: 'List the cassette collection and current playback state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => ({ tapes: tracks.map(({ id, title, artist }) => ({ id, title, artist })), currentTape: ejected ? null : current + 1, playing: !audio.paused && !ejected }),
  }, {
    name: 'play_mixtape', title: 'Play a mixtape',
    description: 'Load a cassette by its tape number and start audio playback. Browser playback permission may require pressing play.',
    inputSchema: { type: 'object', properties: { tapeNumber: { type: 'integer', minimum: 1, maximum: tracks.length } }, required: ['tapeNumber'], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async (input) => {
      if (!input || !Number.isInteger(input.tapeNumber) || input.tapeNumber < 1 || input.tapeNumber > tracks.length) throw new Error(`Choose a tape number from 1 to ${tracks.length}.`);
      const started = await loadTape(input.tapeNumber - 1, true);
      return { tapeNumber: current + 1, playing: Boolean(started && !audio.paused), message: $('status').textContent };
    },
  }, {
    name: 'pause_mixtape', title: 'Pause the mixtape', description: 'Pause the currently loaded cassette.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: () => { pausePlayback(); return { playing: false }; },
  }];
  for (const tool of tools) {
    try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional API: normal controls remain available. */ }
  }
  window.addEventListener('pagehide', (event) => { if (!event.persisted) lifecycle.abort(); });
}
