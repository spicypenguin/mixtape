# Mixtape

A portable, dependency-free 1980s stereo cassette player. UI source lives in `src/`; the tape catalog lives in `config/tapes.json`. Run `npm run build` to combine them into the static `dist/` site. No server runtime is needed in production.

## Local preview

Requires Node.js. Run `npm run dev`, then visit http://127.0.0.1:4173. Run `npm run check` to check JavaScript syntax.

## Audio

`config/tapes.json` contains the active 11-tape collection, including merged Rounds 09 and 10 with chapter timings. The renamed MP3s are in the Git-ignored `tracks/` folder and uploaded to the audio origin. `audioBaseUrl` currently points to `https://mixtape.ididthis.xyz/`. Audio is streamed directly, not proxied, bundled, or downloaded in full up front. Only the loaded tape requests metadata.

If moving the website hostname to a different host, first give the current audio bucket/CDN a separate HTTPS hostname (for example `audio.ididthis.xyz`) and change `audioBaseUrl` in the catalog to that verified origin. Otherwise the old MP3 URLs would resolve to the new frontend and stop working. If keeping both website and audio on the existing S3/CloudFront origin, no change is needed.

The audio element deliberately does not set `crossorigin`: ordinary remote audio playback works without requiring new CORS settings on the existing bucket. The visual meters are a playback animation, not a measurement of the audio waveform. Seeking relies on the audio origin's byte-range support.

## Deployment

For automated GitHub builds and S3 deployment, see [GitHub Actions setup](docs/github-deployment.md). The workflow uses AWS OIDC and preserves all audio objects.

- **S3 + CloudFront:** upload the contents of `dist/` beside the MP3s. Do not delete or overwrite audio objects. Invalidate the five frontend paths after deployment; do not use a bucket sync with `--delete`.
- **Vercel / Netlify:** import the Git repository, use `npm run build` as the build command, and set the publish/output directory to `dist`. Audio must use its own hostname before moving the current site domain.
- **NAS:** serve `dist/` through a static web server. The frontend has no Node runtime requirement. Audio can stay on AWS.

## Controls and accessibility

The player starts with an empty deck and makes no audio request until a tape is selected or Play is pressed. Browse cassette spines by title and artist. Play/pause, previous/next tape, rewind/forward 15 seconds, eject/reload, a rotary volume dial with mute, a seek bar, automatic next tape, and supported OS media controls are included. Space toggles playback and left/right arrows seek when focus is outside interactive controls. Turn the volume dial with a mouse or touch; arrow keys adjust it in small steps, Page Up/Down in larger steps, and Home/End select its minimum/maximum. Animation respects reduced-motion preferences. Optional WebMCP tools are registered only in browsers that support the API.

The L/R output meters animate independently while audio is playing and stop on pause, buffering, mute, or eject. Their display follows the volume setting but is simulated: the current audio origin does not return the CORS headers needed for cross-origin Web Audio analysis.

## Merge split tapes

See [tools/README.md](tools/README.md) for the Python utility that merges Round 9, Round X, or a custom ordered set of files into one MP3 with embedded ID3 chapters and a website-friendly JSON chapter file. It creates local outputs only.

Typography uses Google Fonts with local system fallbacks. No analytics, accounts, cookies, or database.

## Updating the collection

Edit `config/tapes.json`, not generated `dist/tracks.js`. Each tape has a stable `id`, display `title`, `artist`, and audio `file` relative to `audioBaseUrl`. Optional `chapters` contain a title and start/end seconds; the player exposes a chapter selector and uses previous/next to skip chapters.

To update the collection:

1. Upload new MP3s to the existing audio bucket using the filenames in the catalog. Keep existing remote objects available for old links.
2. Verify all new URLs are playable, then update `config/tapes.json`.
3. Run `npm run build` and `npm test`, then deploy `dist/`.

`npm run download:tracks` downloads the active catalog into ignored `tracks/`. Local MP3s and chapter sidecars are never committed.
