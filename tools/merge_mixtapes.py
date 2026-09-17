#!/usr/bin/env python3
"""Merge split mixes into chaptered MP3s. Requires Python 3.10+, FFmpeg, mutagen.

Examples:
  python tools/merge_mixtapes.py --preset both --input-dir ./originals
  python tools/merge_mixtapes.py --preset both --download
  python tools/merge_mixtapes.py track01.mp3 track02.mp3 --title "My mix"

Inputs are never modified. Outputs include embedded ID3 CHAP/CTOC markers and
a .chapters.json sidecar, since HTML audio doesn't expose MP3 chapters.
"""
from __future__ import annotations

import argparse
import copy
from collections import Counter
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen

SAMPLE_RATE = 44100
BYTES_PER_FRAME = 4  # Stereo signed 16-bit PCM.
PRESETS = {
    "round9": {
        "title": "Round 9 - The Year of the Trash",
        "files": [f"{i:02d}-tableTRASH-Round_9_-_The_Year_of_the_Trash.mp3" for i in range(8, 26)],
    },
    "round10": {
        "title": "Round X",
        "files": [f"{i + 26}-tableTRASH%20-%20tableTRASH%20_%20ROUND_X{'_' + str(i) if i else ''}.mp3" for i in range(20)],
    },
}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", type=Path, help="Local files in playback order; no implicit sorting")
    parser.add_argument("--preset", choices=["round9", "round10", "both"], help="Use the original website's exact track order")
    parser.add_argument("--input-dir", type=Path, default=Path("."), help="Folder of original MP3s for a preset")
    parser.add_argument("--download", action="store_true", help="Download preset sources into temporary storage")
    parser.add_argument("--base-url", default="https://mixtape.ididthis.xyz/", help="MP3 origin for --download")
    parser.add_argument("--output-dir", type=Path, default=Path("merged"))
    parser.add_argument("--title", help="Mix title; only valid for one output")
    parser.add_argument("--artist", default="tableTRASH")
    parser.add_argument("--chapter-titles", type=Path, help="JSON array of track titles, in input order; one output only")
    parser.add_argument("--bitrate", choices=["128k", "192k", "256k", "320k"], default="320k")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable name or full path")
    parser.add_argument("--overwrite", action="store_true", help="Explicitly allow replacing existing output files")
    parser.add_argument("--dry-run", action="store_true", help="Show file order without downloading or encoding")
    parser.add_argument("--update-config", type=Path, help="Replace the merged source entries in this tape config after successful merging")
    parser.add_argument("--import-chapters", nargs="+", type=Path, help="Update config from existing .chapters.json files without re-encoding")
    args = parser.parse_args(argv)
    if args.import_chapters:
        if not args.update_config or args.files or args.preset or args.download:
            parser.error("--import-chapters requires --update-config and cannot be combined with files, --preset, or --download.")
        return args
    if bool(args.files) == bool(args.preset):
        parser.error("Choose either explicit files or --preset, not both.")
    if args.download and not args.preset:
        parser.error("--download requires --preset.")
    if args.preset == "both" and (args.title or args.chapter_titles):
        parser.error("--title and --chapter-titles require a single output.")
    if args.download and urlparse(args.base_url).scheme not in ("https", "http"):
        parser.error("--base-url must be an HTTP(S) URL.")
    return args


def slug(title):
    # Portable filenames, including Windows reserved device-name handling.
    value = re.sub(r"[^\w.-]+", "-", title, flags=re.UNICODE).strip(".-")[:100] or "mixtape"
    if value.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *[f"COM{i}" for i in range(1, 10)], *[f"LPT{i}" for i in range(1, 10)]}:
        value = "mix-" + value
    return value


def source_name(value):
    return unquote(str(value).replace("\\", "/").rsplit("/", 1)[-1])


def catalog_with_merges(config, mixes):
    """Return a new catalog; fail closed if sources are missing or ambiguous."""
    updated = copy.deepcopy(config)
    if not isinstance(updated, dict) or not isinstance(updated.get("tapes"), list):
        raise ValueError("Expected a tape config object with a tapes array.")
    for mix in mixes:
        if not isinstance(mix, dict) or not all(isinstance(mix.get(k), str) and mix[k].strip() for k in ("title", "file")) or not isinstance(mix.get("artist"), str):
            raise ValueError("Invalid merged-tape metadata: title, artist, and file are required.")
        chapters = mix.get("chapters")
        if not isinstance(chapters, list) or not chapters:
            raise ValueError("The chapter file must contain at least one chapter.")
        previous_end = 0
        names = []
        for index, chapter in enumerate(chapters):
            start, end = chapter.get("startSeconds"), chapter.get("endSeconds")
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or not (start >= previous_end and end > start and end < float("inf")) or (index == 0 and start != 0):
                raise ValueError("Chapter times must start at zero and be ordered without overlaps.")
            if not isinstance(chapter.get("title"), str) or not chapter["title"].strip() or not chapter.get("source"):
                raise ValueError("Each chapter needs a title and source filename.")
            previous_end = end
            names.append(source_name(chapter["source"]))
        if len(set(names)) != len(names):
            raise ValueError("Cannot update config for duplicate source filenames.")
        identifier = "merged-" + slug(mix["title"]).lower()
        tapes = updated["tapes"]
        existing = [i for i, tape in enumerate(tapes) if tape.get("id") == identifier]
        if existing:
            if len(existing) != 1 or tapes[existing[0]].get("file") != mix["file"] or tapes[existing[0]].get("mergedFrom") != names:
                raise ValueError(f"Tape ID collision: {identifier}")
            positions = existing
        else:
            positions = []
            for name in names:
                matches = [i for i, tape in enumerate(tapes) if source_name(tape.get("file", "")) == name]
                if len(matches) != 1:
                    raise ValueError(f"Expected exactly one config entry for {name}; found {len(matches)}.")
                positions.append(matches[0])
            if positions != sorted(positions) or positions != list(range(positions[0], positions[0] + len(positions))):
                raise ValueError("Source tapes must be consecutive and in chapter order in the config.")
        entry = {"id": identifier, "title": mix["title"], "artist": mix["artist"], "file": mix["file"], "durationSeconds": previous_end,
                 "chapters": [{k: chapter[k] for k in ("title", "startSeconds", "endSeconds")} for chapter in chapters], "mergedFrom": names}
        updated["tapes"] = [entry if i == positions[0] else tape for i, tape in enumerate(tapes) if i == positions[0] or i not in positions]
    return updated


def update_catalog(path, mixes, dry_run=False):
    path = path.resolve()
    original = path.read_text(encoding="utf-8-sig")
    config = json.loads(original)
    updated = catalog_with_merges(config, mixes)
    if dry_run:
        print(f"Would update {path}: {len(config['tapes'])} -> {len(updated['tapes'])} tapes. No files changed.")
        return
    # A sibling temporary file allows an atomic replacement on the same volume.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".tapes-", suffix=".tmp", delete=False) as stream:
        pending = Path(stream.name)
        json.dump(updated, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    try:
        if path.read_text(encoding="utf-8-sig") != original:
            raise RuntimeError("Tape config changed during import; refusing to overwrite it.")
        pending.replace(path)
    finally:
        pending.unlink(missing_ok=True)
    print(f"Updated {path}: {len(config['tapes'])} -> {len(updated['tapes'])} tapes.")
    print("Upload the merged MP3s to the configured audio origin BEFORE building and deploying the updated catalog.")


def plans(args):
    if args.files:
        return [(args.title or "Mixtape", [p.resolve() for p in args.files])]
    names = ["round9", "round10"] if args.preset == "both" else [args.preset]
    result = []
    for name in names:
        preset = PRESETS[name]
        if args.download:
            sources = [urljoin(args.base_url.rstrip("/") + "/", file) for file in preset["files"]]
        else:
            sources = []
            for file in preset["files"]:
                decoded = args.input_dir / unquote(file)
                encoded = args.input_dir / file
                sources.append((decoded if decoded.exists() else encoded).resolve())
        result.append((args.title or preset["title"], sources))
    return result


def run_ffmpeg(executable, arguments, *, stdout=subprocess.DEVNULL):
    command = [executable, "-hide_banner", "-loglevel", "error", "-nostdin", *arguments]
    result = subprocess.run(command, stdout=stdout, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        error = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg failed: {error[-4000:]}")


def read_titles(files, supplied):
    from mutagen.id3 import ID3, ID3NoHeaderError
    if supplied:
        titles = json.loads(supplied.read_text(encoding="utf-8-sig"))
        if not isinstance(titles, list) or len(titles) != len(files) or not all(isinstance(t, str) and t.strip() for t in titles):
            raise ValueError("Chapter titles must be a JSON array with one nonempty string per source file.")
        return [title.strip() for title in titles]
    titles = []
    for file in files:
        try:
            tag = ID3(file).get("TIT2")
            titles.append(str(tag).strip() if tag else "")
        except ID3NoHeaderError:
            titles.append("")
    counts = Counter(titles)
    # Split mixes often repeat the album title in every track. Don't mistake it
    # for a song title: use meaningful, unique numbered chapter labels instead.
    return [title if title and counts[title] == 1 else f"Track {i:02d}" for i, title in enumerate(titles, 1)]


def merge(title, sources, args, ffmpeg):
    from mutagen.id3 import ID3, CHAP, CTOC, CTOCFlags, TIT2, TPE1, TALB
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / (slug(title) + ".mp3")
    sidecar = output.with_suffix(".chapters.json")
    for target in (output, sidecar):
        if target.exists() and not args.overwrite:
            raise FileExistsError(f"Already exists: {target}. Use --overwrite to replace it.")
        if any(isinstance(source, Path) and target == source for source in sources):
            raise ValueError(f"Output would overwrite an input: {target}")
    # Keep intermediates next to the output for atomic final renames. PCM takes
    # roughly 635 MB/hour; downloaded inputs and the encoded MP3 add to this.
    with tempfile.TemporaryDirectory(prefix=".merge-mixtape-", dir=output_dir) as temp:
        work = Path(temp)
        local_files = []
        for i, source in enumerate(sources, 1):
            if isinstance(source, Path):
                if not source.is_file():
                    raise FileNotFoundError(f"Missing source: {source}")
                local_files.append(source)
                continue
            print(f"  Downloading {i}/{len(sources)}…", flush=True)
            dest = work / f"source-{i:03d}.mp3"
            request = Request(source, headers={"User-Agent": "MixtapeMerge/1.0"})
            with urlopen(request, timeout=60) as response, dest.open("wb") as stream:
                shutil.copyfileobj(response, stream)
            local_files.append(dest)
        titles = read_titles(local_files, args.chapter_titles)
        chapters = []
        combined = work / "combined.pcm"
        with combined.open("wb") as pcm:
            for i, (file, chapter_title) in enumerate(zip(local_files, titles), 1):
                print(f"  Decoding {i}/{len(local_files)}: {chapter_title}", flush=True)
                start_byte = pcm.tell()
                run_ffmpeg(ffmpeg, ["-i", str(file), "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], stdout=pcm)
                end_byte = pcm.seek(0, 2)
                if end_byte <= start_byte or (end_byte - start_byte) % BYTES_PER_FRAME:
                    raise ValueError(f"No complete audio frames decoded from {file}")
                start_ms = round(start_byte * 1000 / (SAMPLE_RATE * BYTES_PER_FRAME))
                end_ms = round(end_byte * 1000 / (SAMPLE_RATE * BYTES_PER_FRAME))
                if end_ms <= start_ms or end_ms >= 0xFFFFFFFF:
                    raise ValueError("Chapter duration falls outside the ID3 millisecond range.")
                chapters.append({"id": f"ch{i:03d}", "title": chapter_title, "startSeconds": start_ms / 1000, "endSeconds": end_ms / 1000, "source": str(sources[i - 1]).replace("\\", "/").rsplit("/", 1)[-1]})
        encoded = work / "merged.mp3"
        print("  Encoding a single continuous MP3…", flush=True)
        run_ffmpeg(ffmpeg, ["-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", str(combined), "-c:a", "libmp3lame", "-b:a", args.bitrate, "-id3v2_version", "3", str(encoded)])
        tags = ID3(encoded)
        tags.add(TIT2(encoding=3, text=[title]))
        tags.add(TPE1(encoding=3, text=[args.artist]))
        tags.add(TALB(encoding=3, text=[title]))
        for chapter in chapters:
            tags.add(CHAP(element_id=chapter["id"], start_time=round(chapter["startSeconds"] * 1000), end_time=round(chapter["endSeconds"] * 1000), sub_frames=[TIT2(encoding=3, text=[chapter["title"]])]))
        tags.add(CTOC(element_id="toc", flags=CTOCFlags.TOP_LEVEL | CTOCFlags.ORDERED, child_element_ids=[c["id"] for c in chapters], sub_frames=[TIT2(encoding=3, text=["Tracks"])]))
        tags.save(encoded, v2_version=3)
        verified = ID3(encoded)
        if len(verified.getall("CHAP")) != len(chapters) or len(verified.getall("CTOC")) != 1:
            raise RuntimeError("Embedded chapter verification failed; output was not published.")
        for chapter in chapters:
            frame = verified.get("CHAP:" + chapter["id"])
            if frame is None or frame.start_time != round(chapter["startSeconds"] * 1000) or frame.end_time != round(chapter["endSeconds"] * 1000):
                raise RuntimeError("Chapter timing verification failed.")
        metadata = {"title": title, "artist": args.artist, "file": output.name, "durationSeconds": chapters[-1]["endSeconds"], "chapters": chapters}
        json_file = work / "chapters.json"
        json_file.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        # Refuse accidental overwrite even if a target appeared during encoding.
        if not args.overwrite and (output.exists() or sidecar.exists()):
            raise FileExistsError("An output appeared during encoding; refusing to overwrite it.")
        encoded.replace(output)
        json_file.replace(sidecar)
    print(f"Created: {output}\nChapters: {sidecar}", flush=True)
    return metadata


def main(argv=None):
    args = parse_args(argv)
    if args.import_chapters:
        mixes = [json.loads(path.read_text(encoding="utf-8-sig")) for path in args.import_chapters]
        update_catalog(args.update_config, mixes, args.dry_run)
        return 0
    jobs = plans(args)
    for title, sources in jobs:
        print(f"{title} — {len(sources)} tracks")
        if args.dry_run:
            for i, source in enumerate(sources, 1):
                print(f"  {i:02d}. {source}")
    if args.dry_run:
        return 0
    try:
        import mutagen.id3  # noqa: F401
    except ImportError:
        raise RuntimeError("Install the dependency first: python -m pip install mutagen") from None
    ffmpeg = shutil.which(args.ffmpeg)
    if not ffmpeg:
        raise RuntimeError("FFmpeg was not found. Install FFmpeg with libmp3lame, or use --ffmpeg FULL_PATH.")
    # Validate all local inputs before starting either output.
    for _, sources in jobs:
        for source in sources:
            if isinstance(source, Path) and not source.is_file():
                raise FileNotFoundError(f"Missing source: {source}")
    if args.update_config:
        # Check all replacements before any potentially lengthy downloads/encoding.
        preview = [{"title": title, "artist": args.artist, "file": slug(title) + ".mp3", "chapters": [{"title": f"Track {i+1}", "startSeconds": i, "endSeconds": i+1, "source": source_name(source)} for i, source in enumerate(sources)]} for title, sources in jobs]
        catalog_with_merges(json.loads(args.update_config.read_text(encoding="utf-8-sig")), preview)
    mixes = [merge(title, sources, args, ffmpeg) for title, sources in jobs]
    if args.update_config:
        update_catalog(args.update_config, mixes)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
