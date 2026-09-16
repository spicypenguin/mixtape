import { tracks } from './tracks.js';

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const box = $('boombox');
const shelf = $('tape-shelf');
const seek = $('seek');
const volume = $('volume');
let current = 0;
let ejected = false;
let expanded = false;
let requestId = 0;
let lastVolume = .75;
let seeking = false;
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

function drawShelf() {
  const fragment = document.createDocumentFragment();
  for (const [i, track] of tracks.entries()) {
    const item = document.createElement('li');
    item.hidden = !expanded && i >= 8 && (i !== current || ejected);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tape-card';
    button.setAttribute('aria-label', `Load and play tape ${track.id}: ${track.title}${track.artist ? ` by ${track.artist}` : ''}`);
    button.setAttribute('aria-pressed', String(i === current && !ejected));
    button.style.setProperty('--tape-color', colors[i % colors.length][0]);
    button.style.setProperty('--tape-accent', colors[i % colors.length][1]);
    // All varying text is assigned with textContent, never interpreted as HTML.
    button.innerHTML = `<div class="mini-cassette" aria-hidden="true"><div class="mini-label"><div class="mini-topline"><b>A</b><span class="mini-artist"></span><span class="mini-id"></span></div><div class="mini-title"></div><div class="mini-stripe"></div></div><div class="mini-reels"><i></i><i></i></div><div class="mini-bottom"><span>HIGH BIAS</span><span>STEREO</span></div></div><div class="tape-info"><span class="card-number"></span><span class="card-copy"><span class="card-title"></span><span class="card-artist"></span></span></div>`;
    button.querySelector('.mini-artist').textContent = track.artist || 'MIXTAPE';
    button.querySelector('.mini-id').textContent = String(track.id).padStart(2, '0');
    button.querySelector('.mini-title').textContent = track.title;
    button.querySelector('.card-number').textContent = String(track.id).padStart(2, '0');
    button.querySelector('.card-title').textContent = track.title;
    button.querySelector('.card-artist').textContent = track.artist || 'DJ mix';
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
    item.hidden = !expanded && i >= 8 && (i !== current || ejected);
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
  $('counter').textContent = String(Math.floor(ejected ? 0 : position)).padStart(4, '0');
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try {
      if (knownDuration) navigator.mediaSession.setPositionState({ duration, playbackRate: audio.playbackRate, position: Math.min(position, duration) });
      else navigator.mediaSession.setPositionState();
    } catch { /* Older browsers can reject position updates while changing source. */ }
  }
}

function updatePlayback() {
  const playing = !audio.paused && !audio.ended && !ejected;
  box.classList.toggle('is-playing', playing);
  $('play').classList.toggle('is-active', playing);
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('play-label').textContent = playing ? 'PAUSE' : 'PLAY';
  $('play-icon').textContent = playing ? 'Ⅱ' : '▶';
  $('power-label').textContent = playing ? 'PLAYING' : 'STANDBY';
  $('playback-state').textContent = ejected ? 'DECK EMPTY' : `${playing ? 'NOW PLAYING' : audio.currentTime ? 'PAUSED' : 'READY TO PLAY'} · TAPE ${String(current + 1).padStart(2, '0')}`;
  for (const id of ['rewind', 'forward', 'eject']) $(id).disabled = ejected;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = ejected ? 'none' : playing ? 'playing' : 'paused';
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
  $('now-title').textContent = 'Room for another mixtape.';
  $('now-artist').textContent = 'Choose a cassette from the shelf.';
  document.title = 'Mixtape — Press play.';
  status('Tape ejected. Pick a tape, or press play to reload.');
  updateShelfSelection();
  updateProgress();
  updatePlayback();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

function syncVolume() {
  const silent = audio.muted || audio.volume === 0;
  $('mute').setAttribute('aria-pressed', String(silent));
  $('mute').setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
  volume.value = String(audio.muted ? 0 : Math.round(audio.volume * 100));
  volume.setAttribute('aria-valuetext', `${volume.value}%`);
}

$('play').addEventListener('click', togglePlayback);
$('previous').addEventListener('click', () => loadTape(current - 1, true));
$('next').addEventListener('click', () => loadTape(current + 1, true));
$('rewind').addEventListener('click', () => skip(-15));
$('forward').addEventListener('click', () => skip(15));
$('eject').addEventListener('click', ejectTape);
$('mute').addEventListener('click', () => {
  if (audio.volume === 0) { audio.volume = lastVolume; audio.muted = false; }
  else audio.muted = !audio.muted;
  syncVolume();
});
volume.addEventListener('input', () => {
  audio.volume = Number(volume.value) / 100;
  audio.muted = false;
  if (audio.volume > 0) lastVolume = audio.volume;
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
  $('show-all').innerHTML = expanded ? 'Show fewer tapes <span aria-hidden="true">↑</span>' : 'View all 47 tapes <span aria-hidden="true">↓</span>';
});

audio.addEventListener('playing', () => { box.classList.remove('is-buffering'); updatePlayback(); status('Tape rolling.'); });
audio.addEventListener('play', updatePlayback);
audio.addEventListener('pause', updatePlayback);
audio.addEventListener('waiting', () => {
  if (!audio.paused && !ejected) { box.classList.add('is-buffering'); status('Buffering the tape…'); }
});
audio.addEventListener('canplay', () => box.classList.remove('is-buffering'));
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
  if (event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
  else if (event.code === 'ArrowLeft') { event.preventDefault(); skip(-15); }
  else if (event.code === 'ArrowRight') { event.preventDefault(); skip(15); }
});

if ('mediaSession' in navigator) {
  const actions = {
    play: startPlayback, pause: pausePlayback,
    previoustrack: () => loadTape(current - 1, true), nexttrack: () => loadTape(current + 1, true),
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
audio.volume = .75;
syncVolume();
loadTape(0);

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
      if (!input || !Number.isInteger(input.tapeNumber) || input.tapeNumber < 1 || input.tapeNumber > tracks.length) throw new Error('Choose a tape number from 1 to 47.');
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
