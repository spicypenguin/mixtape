# Merge split mixtapes

Install Python 3.10+, [FFmpeg](https://ffmpeg.org/download.html) with the libmp3lame encoder, and the Python dependency:

```sh
python -m pip install -r tools/requirements.txt
```

Merge the existing Round 9 (18 parts) and Round X / Round 10 (20 parts) directly from the live audio URLs:

```sh
python tools/merge_mixtapes.py --preset both --download
```

Or use files already downloaded from S3:

```sh
python tools/merge_mixtapes.py --preset both --input-dir ./originals
```

Use `--preset round9` or `--preset round10` for only one tape. `--dry-run` prints the exact input order without downloading or encoding. The preset filenames and order come from the existing website, including Round X's unsuffixed first part, then `_1` through `_19`. Local files may use decoded spaces or the original URL-encoded names.

For any other tape, supply files in the desired playback order:

```sh
python tools/merge_mixtapes.py "01.mp3" "02.mp3" "03.mp3" --title "My mix" --artist "DJ name"
```

The `merged/` folder receives one MP3 and one `.chapters.json` per tape. The MP3 has ID3 CHAP chapter frames and an ordered CTOC table, which chapter-aware players can use to jump between tracks. Ordinary HTML audio does **not** expose these markers. The JSON contains chapter titles and start/end seconds for a website chapter list or next/previous-track controls; website chapter integration is a separate step.

Chapter titles come from each source's title tag. Missing or repeated titles become `Track 01`, `Track 02`, etc. To supply song names, pass `--chapter-titles titles.json`, where the file is a JSON array containing one title per input file. Run presets separately when supplying titles.

The script decodes each part to stereo 44.1 kHz PCM, joins the decoded samples, and encodes once at 320 kbps. This accommodates differing source sample rates/channels, avoids repeated MP3 encoder padding at the joins, and adds no silence or crossfades. MP3 re-encoding is lossy; it cannot restore source quality or remove silence already present in the recordings. Use `--bitrate 192k` for smaller files. Allow roughly 635 MB of temporary PCM space per hour of audio, plus downloads and output.

Originals remain untouched. Existing outputs are rejected unless `--overwrite` is supplied. The script verifies embedded chapter counts and timings before moving the finished files into place. Downloads and intermediate PCM are cleaned up on success or failure. Outputs are local only; nothing is uploaded to S3 or changed on the website.
