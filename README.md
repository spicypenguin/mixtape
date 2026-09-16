# Mixtape

A portable, dependency-free 1980s stereo cassette player. The authored site is in `dist/` and can be uploaded directly to static hosting. No server or build step is needed in production.

## Local preview

Requires Node.js. Run `npm run dev`, then visit http://127.0.0.1:4173. Run `npm run check` to check JavaScript syntax.

## Audio

`dist/tracks.js` preserves the 47 original MP3 filenames, including repeated track titles that refer to different files. `AUDIO_BASE` currently points to `https://mixtape.ididthis.xyz/`. Audio is streamed directly, not proxied, bundled, or downloaded in full up front. Only the loaded tape requests metadata.

If moving the website hostname to a different host, first give the current audio bucket/CDN a separate HTTPS hostname (for example `audio.ididthis.xyz`) and change `AUDIO_BASE` to that verified origin. Otherwise the old MP3 URLs would resolve to the new frontend and stop working. If keeping both website and audio on the existing S3/CloudFront origin, no change is needed.

The audio element deliberately does not set `crossorigin`: ordinary remote audio playback works without requiring new CORS settings on the existing bucket. The visual meters are a playback animation, not a measurement of the audio waveform. Seeking relies on the audio origin's byte-range support.

## Deployment

- **S3 + CloudFront:** upload the contents of `dist/` beside the MP3s. Do not delete or overwrite audio objects. Invalidate the five frontend paths after deployment; do not use a bucket sync with `--delete`.
- **Vercel / Netlify:** import the Git repository, use no build command, and set the publish/output directory to `dist`. Audio must use its own hostname before moving the current site domain.
- **NAS:** serve `dist/` through a static web server. The frontend has no Node runtime requirement. Audio can stay on AWS.

## Controls and accessibility

Play/pause, previous/next tape, rewind/forward 15 seconds, eject/reload, volume/mute, seek bar, automatic next tape, and supported OS media controls. Space toggles playback and left/right arrows seek when focus is outside interactive controls. Native buttons and sliders remain keyboard accessible. Animation respects reduced-motion preferences. Optional WebMCP tools are registered only in browsers that support the API.

Typography uses Google Fonts with local system fallbacks. No analytics, accounts, cookies, or database.
