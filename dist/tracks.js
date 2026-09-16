// Exact filenames and original titles from mixtape.ididthis.xyz.
// Audio stays in the existing bucket; no MP3s are copied into this project.
export const AUDIO_BASE = 'https://mixtape.ididthis.xyz/';
const first = [
  ["01-TableTRASH-Round_2!_Its_here!.mp3", "Round 2! It's here!"],
  ['02-tableTRASH-Round_3!_About_time_already.mp3', 'Round 3! About time already...'],
  ['03-tableTRASH-Knockout_Round_4.mp3', 'Knockout (Round 4)'],
  ['04-tableTRASH-A_Round_About_Time.mp3', 'A Round (About Time)'],
  ['05-tableTRASH-roundSIX.mp3', 'roundSIX'],
  ['06-tableTRASH%20-%20roundSEVEN%20__%20Vote%20for%20us%20on%20ITM%20TOP%2050!.mp3', 'roundSEVEN // Vote for us on ITM TOP 50!'],
  ['07-tableTRASH-Round_8mp3.mp3', 'Round 8'],
];
export const tracks = [
  ...first.map(([file, title]) => ({ file, title, artist: 'tableTRASH' })),
  ...Array.from({ length: 18 }, (_, i) => ({
    file: `${String(i + 8).padStart(2, '0')}-tableTRASH-Round_9_-_The_Year_of_the_Trash.mp3`,
    title: 'Round 9 — The Year of the Trash', artist: 'tableTRASH',
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    file: `${i + 26}-tableTRASH%20-%20tableTRASH%20_%20ROUND_X${i ? `_${i}` : ''}.mp3`,
    title: 'tableTRASH / ROUND_X', artist: 'tableTRASH',
  })),
  { file: '46--fRews_Feburary_2011_DJ_Mix.mp3', title: "fRew's Feburary 2011 DJ Mix", artist: 'fRew' },
  { file: '47--Marcellos_Birthday_Teasermp3.mp3', title: "Marcello's Birthday Teaser", artist: '' },
].map((track, index) => ({ ...track, id: index + 1, url: new URL(track.file, AUDIO_BASE).href }));
