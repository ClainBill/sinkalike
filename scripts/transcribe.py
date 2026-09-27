#!/usr/bin/env python3
"""Transcribe an episode into src/content/transcripts/<slug>.json (+ public/transcripts/<slug>.vtt).

Best: one audio file per person, exported from the FINAL edit so every track lines up with
the published episode (same length, same cuts, intro included):

    npm run transcribe -- 2 --track adam=~/Stems/adam.wav --track william=~/Stems/william.wav

Every line is attributed to the track it came from, so speakers are exact. Guests work the
same way (--track guest-name=path).

Otherwise: transcribe the published mix from the RSS feed and detect speakers automatically:

    npm run transcribe -- 2 --mixed

Voices are clustered with a speaker-recognition model, then named from cues in the
conversation ("I'm your host, Adam…", "William, what did you think?"). Check the summary it
prints; if names are swapped or unclear, pin one down with --anchor adam=12.5 (a time in
seconds where that person is talking). --no-speakers skips detection entirely.

Setup (once):  python3 -m venv .venv && .venv/bin/pip install mlx-whisper speechbrain scikit-learn
Words Whisper tends to mishear (names, film titles) go in scripts/vocab.txt.
"""

from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FEED = ROOT / "src/data/feed.json"
EPISODES = ROOT / "src/content/episodes"
PEOPLE = ROOT / "src/content/people"
TRANSCRIPTS = ROOT / "src/content/transcripts"
VTT_DIR = ROOT / "public/transcripts"
CACHE = ROOT / ".cache"
VOCAB = ROOT / "scripts/vocab.txt"
SAMPLE_RATE = 16_000

# Phrases Whisper invents over silence on isolated tracks.
HALLUCINATIONS = re.compile(
    r"^(thanks? (you )?(for|so much)?( watching| listening)?[.!]?|thank you\.?|you\.?|bye\.?|\.+|"
    r"subtitles by.*|please subscribe.*|♪+)$",
    re.I,
)


# ---------------------------------------------------------------- episode + people


def load_episode(ref: str) -> dict:
    feed = json.loads(FEED.read_text())
    for episode in feed["episodes"]:
        if ref in (str(episode["number"]), episode["slug"]):
            return episode
    sys.exit(f"No episode matching {ref!r} in {FEED.relative_to(ROOT)}. Run `npm run sync` first?")


def frontmatter_list(text: str, key: str) -> list[str]:
    match = re.search(rf"^{key}:\s*\[([^\]]*)\]", text, re.M)
    return [item.strip().strip("\"'") for item in match.group(1).split(",") if item.strip()] if match else []


def people() -> dict[str, str]:
    """person id -> display name, in site order."""
    found = []
    for file in PEOPLE.glob("*.md"):
        text = file.read_text()
        name = re.search(r"^name:\s*(.+)$", text, re.M)
        order = re.search(r"^order:\s*(\d+)", text, re.M)
        found.append((int(order.group(1)) if order else 0, file.stem, name.group(1).strip().strip("\"'") if name else file.stem))
    return {pid: name for _, pid, name in sorted(found)}


def speakers_for(episode: dict) -> list[str]:
    """Who's on this episode: participants from the episode file (default: all hosts) plus guests."""
    everyone = list(people())
    file = EPISODES / f"{episode['slug']}.md"
    if not file.exists():
        return everyone
    text = file.read_text()
    participants = frontmatter_list(text, "participants") or everyone
    block = re.search(r"^guests:(.*?)(?=^\w|\Z)", text, re.M | re.S)
    names = re.findall(r"name:\s*[\"']?([^\"',}\n]+)", block.group(1)) if block else []
    guests = [re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") for name in names]
    return participants + guests


def vocabulary(episode: dict) -> str:
    words = ["Sink Alike", *people().values()]
    if VOCAB.exists():
        words += [line.strip() for line in VOCAB.read_text().splitlines() if line.strip() and not line.startswith("#")]
    words.append(episode["title"])
    return "Vocabulary: " + ", ".join(dict.fromkeys(words)) + "."


def download(episode: dict) -> Path:
    folder = CACHE / "audio"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{episode['slug']}{Path(episode['audio']['url'].split('?')[0]).suffix or '.mp3'}"
    if not target.exists():
        print(f"Downloading published audio → {target.relative_to(ROOT)}")
        request = urllib.request.Request(episode["audio"]["url"], headers={"User-Agent": "sinkalike-transcriber"})
        with urllib.request.urlopen(request) as response, open(target, "wb") as out:
            out.write(response.read())
    return target


# ---------------------------------------------------------------- whisper


def whisper_words(audio: np.ndarray, model: str, prompt: str, isolated: bool, cache: Path | None, fresh: bool) -> list[dict]:
    """Word-level transcript: [{start, end, word}]. Cached so speaker detection can be re-run cheaply."""
    if cache and cache.exists() and not fresh:
        data = json.loads(cache.read_text())
        if data.get("model") == model:
            print(f"Using cached Whisper output ({cache.relative_to(ROOT)}; --fresh to redo)")
            return data["words"]

    import mlx_whisper

    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model,
        language="en",
        word_timestamps=True,
        initial_prompt=prompt,
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0 if isolated else None,
        verbose=False,
    )
    words = []
    for segment in result["segments"]:
        if segment.get("no_speech_prob", 0) > 0.6 and segment.get("avg_logprob", 0) < -1.0:
            continue
        text = segment["text"].strip()
        if not text or HALLUCINATIONS.match(text):
            continue
        for word in segment.get("words", []):
            if word["word"].strip():
                words.append({"start": round(word["start"], 3), "end": round(word["end"], 3), "word": word["word"]})
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"model": model, "words": words}))
    return words


def to_lines(words: list[dict]) -> list[dict]:
    """Group words into sentence-sized lines. A change of speaker always starts a new line,
    so search results and click-to-seek land close to the actual quote."""
    lines, current = [], []

    def flush():
        if current:
            lines.append(
                {"s": current[0]["start"], "e": current[-1]["end"], "sp": current[0].get("sp"), "t": "".join(w["word"] for w in current).strip()}
            )
            current.clear()

    for index, word in enumerate(words):
        if current and word.get("sp") != current[-1].get("sp"):
            flush()
        current.append(word)
        token = word["word"].strip()
        following = words[index + 1] if index + 1 < len(words) else None
        next_gap = following["start"] - word["end"] if following else 0
        sentence_end = token.endswith((".", "?", "!")) and len(current) >= 4
        long_pause = next_gap > 0.8 and len(current) >= 3
        too_long = len(current) >= 28 and token.endswith((",", ";", ":"))
        if sentence_end or long_pause or too_long or len(current) >= 40:
            flush()
    flush()
    # Fold tiny same-speaker fragments into the previous line.
    merged: list[dict] = []
    for line in lines:
        if merged and line["sp"] == merged[-1]["sp"] and len(line["t"].split()) < 3 and line["s"] - merged[-1]["e"] < 0.8:
            merged[-1]["e"] = line["e"]
            merged[-1]["t"] += " " + line["t"]
        else:
            merged.append(line)
    return merged


# ---------------------------------------------------------------- speaker detection

WINDOW = 1.5  # seconds of audio per voice sample
HOP = 0.5


def speech_regions(words: list[dict], gap: float = 0.4) -> list[tuple[float, float]]:
    regions: list[list[float]] = []
    for word in words:
        if regions and word["start"] - regions[-1][1] <= gap:
            regions[-1][1] = max(regions[-1][1], word["end"])
        else:
            regions.append([word["start"], word["end"]])
    return [(a, b) for a, b in regions]


def voice_windows(regions: list[tuple[float, float]]) -> list[tuple[float, float]]:
    windows = []
    for start, end in regions:
        if end - start <= WINDOW:
            mid = (start + end) / 2
            windows.append((max(0.0, mid - WINDOW / 2), mid + WINDOW / 2))
            continue
        t = start
        while t + WINDOW <= end + 1e-6:
            windows.append((t, t + WINDOW))
            t += HOP
        if windows[-1][1] < end - 0.25:
            windows.append((end - WINDOW, end))
    return windows


def embed(audio: np.ndarray, windows: list[tuple[float, float]]) -> np.ndarray:
    import torch
    from speechbrain.inference.speaker import EncoderClassifier

    # Apple GPU is ~100x faster than CPU for this model.
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    encoder = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb", savedir=str(CACHE / "models/ecapa"), run_opts={"device": device}
    )
    size = int(WINDOW * SAMPLE_RATE)
    chunks = []
    for start, _ in windows:
        a = int(start * SAMPLE_RATE)
        chunk = audio[a : a + size]
        chunks.append(np.pad(chunk, (0, size - len(chunk))))
    out = []
    with torch.no_grad():
        for i in range(0, len(chunks), 64):
            batch = torch.from_numpy(np.stack(chunks[i : i + 64])).float().to(device)
            out.append(encoder.encode_batch(batch).squeeze(1).cpu().numpy())
            print(f"\r  Listening for voices… {min(i + 64, len(chunks))}/{len(chunks)}", end="", flush=True)
    print()
    vectors = np.concatenate(out)
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def cluster(vectors: np.ndarray, k: int) -> np.ndarray:
    """Spectral clustering on pruned cosine similarity (standard for speaker diarization)."""
    from sklearn.cluster import SpectralClustering

    similarity = np.clip(vectors @ vectors.T, 0, 1)
    keep = max(10, int(len(vectors) * 0.1))
    threshold = -np.sort(-similarity, axis=1)[:, keep - 1 : keep]
    affinity = np.where(similarity >= threshold, similarity, 0)
    affinity = (affinity + affinity.T) / 2
    labels = SpectralClustering(n_clusters=k, affinity="precomputed", random_state=0, assign_labels="cluster_qr").fit_predict(affinity)
    # Smooth: a window's label is the majority of its neighbours (voices don't flip every 0.5s).
    smoothed = labels.copy()
    for i in range(len(labels)):
        near = labels[max(0, i - 2) : i + 3]
        smoothed[i] = np.bincount(near, minlength=k).argmax()
    return smoothed


def label_words(words: list[dict], windows: list[tuple[float, float]], labels: np.ndarray, k: int) -> None:
    centers = np.array([(a + b) / 2 for a, b in windows])
    previous = 0
    for word in words:
        mid = (word["start"] + word["end"]) / 2
        near = np.where(np.abs(centers - mid) <= WINDOW / 2)[0]
        if len(near):
            weights = 1 - np.abs(centers[near] - mid) / (WINDOW / 2) + 1e-3
            previous = int(np.bincount(labels[near], weights=weights, minlength=k).argmax())
        word["cluster"] = previous
    # A one-word flip between two runs of the same voice is almost always noise.
    for i in range(1, len(words) - 1):
        if words[i - 1]["cluster"] == words[i + 1]["cluster"] != words[i]["cluster"]:
            words[i]["cluster"] = words[i - 1]["cluster"]


def refine_boundaries(words: list[dict], reach: int = 3) -> None:
    """Voice samples are 1.5s long, so a detected switch between speakers can land a word or two
    early or late. Nudge each switch to the most natural nearby break: the end of a sentence,
    then a comma, then the longest pause."""

    def score(j: int, i: int) -> float:
        before = words[j - 1]["word"].strip()
        pause = max(0.0, words[j]["start"] - words[j - 1]["end"])
        return (3 if before.endswith((".", "?", "!")) else 1 if before.endswith((",", ";", ":")) else 0) + min(pause, 1.0) * 4 - 0.6 * abs(j - i)

    i = 1
    while i < len(words):
        if words[i]["cluster"] == words[i - 1]["cluster"]:
            i += 1
            continue
        # Stay between the neighbouring switches so turns never vanish.
        low = i - 1
        while low > 1 and i - low < reach and words[low - 1]["cluster"] == words[i - 1]["cluster"]:
            low -= 1
        high = i + 1
        while high < len(words) and high - i < reach and words[high]["cluster"] == words[i]["cluster"]:
            high += 1
        best = max(range(max(1, low), min(high, len(words) - 1) + 1), key=lambda j: score(j, i))
        speaker_before, speaker_after = words[i - 1]["cluster"], words[i]["cluster"]
        for k in range(min(best, i), max(best, i)):
            words[k]["cluster"] = speaker_before if best > i else speaker_after
        i = max(best, i) + 1


def name_clusters(lines: list[dict], names: dict[str, str], ids: list[str], anchors: dict[str, float]) -> tuple[dict[int, str], list[str]]:
    """Decide which voice is which person from what's said, e.g. "I'm your host, Adam…"
    (said by Adam) or "William, what did you think?" (said to William, so not by him)."""
    k = len(ids)
    votes = np.zeros((k, k))  # votes[cluster, person]
    reasons: list[str] = []
    first_names = {pid: names.get(pid, pid).split()[0] for pid in ids}

    for line in lines:
        c = line["cluster"]
        text = line["t"]
        for p, pid in enumerate(ids):
            first = re.escape(first_names[pid])
            if re.search(rf"\b(i'?m|i am|this is|my name is|it'?s)\s+(your host,?\s+|your co-?host,?\s+)?{first}\b", text, re.I):
                votes[c, p] += 5
                reasons.append(f"“{text[:60]}” ({int(line['s']) // 60}:{int(line['s']) % 60:02})")
            elif re.search(rf"(^|[.?!]\s+)(so,?\s+|well,?\s+|okay,?\s+)?{first}\s*[,?]", text, re.I) and k == 2:
                votes[c, 1 - p] += 1  # addressing someone by name: probably the other person talking
    for pid, t in anchors.items():
        if pid in ids:
            nearest = min(lines, key=lambda line: 0 if line["s"] <= t <= line["e"] else min(abs(line["s"] - t), abs(line["e"] - t)))
            votes[nearest["cluster"], ids.index(pid)] += 1000
            reasons.append(f"--anchor {pid}={t}")

    best = max(itertools.permutations(range(k)), key=lambda perm: sum(votes[c, perm[c]] for c in range(k)))
    confident = votes.sum() > 0
    return {c: ids[best[c]] for c in range(k)}, reasons if confident else []


def diarize(audio: np.ndarray, words: list[dict], ids: list[str], anchors: dict[str, float]) -> None:
    k = len(ids)
    windows = voice_windows(speech_regions(words))
    print(f"Detecting {k} speakers ({', '.join(ids)}) from {len(windows)} voice samples…")
    labels = cluster(embed(audio, windows), k)
    label_words(words, windows, labels, k)
    refine_boundaries(words)

    # Name the voices using whole lines, then copy names onto words.
    for word in words:
        word["sp"] = word["cluster"]
    lines = to_lines(words)
    for line in lines:
        line["cluster"] = line["sp"]
    mapping, reasons = name_clusters(lines, people(), ids, anchors)
    for word in words:
        word["sp"] = mapping[word.pop("cluster")]

    talk = {pid: 0.0 for pid in ids}
    for word in words:
        talk[word["sp"]] += word["end"] - word["start"]
    total = sum(talk.values()) or 1
    print("Speakers:")
    for pid in ids:
        sample = next((line["t"] for line in lines if mapping[line["cluster"]] == pid and len(line["t"]) > 40), "")
        print(f"  {pid:<10} {talk[pid] / total:>4.0%} of talk time   e.g. “{sample[:70]}”")
    if reasons:
        print("  Named using: " + "; ".join(reasons[:3]))
    else:
        print("  ⚠ No name cues found, so names may be swapped. Re-run with --anchor <person>=<seconds> to fix.")


# ---------------------------------------------------------------- output


def to_vtt(segments: list[dict], names: dict[str, str]) -> str:
    def stamp(seconds: float) -> str:
        ms = int(round(seconds * 1000))
        return f"{ms // 3_600_000:02}:{ms // 60_000 % 60:02}:{ms // 1000 % 60:02}.{ms % 1000:03}"

    cues = ["WEBVTT", ""]
    for segment in segments:
        voice = f"<v {names.get(segment['sp'], segment['sp'])}>" if segment.get("sp") else ""
        cues += [f"{stamp(segment['s'])} --> {stamp(segment['e'])}", f"{voice}{segment['t']}", ""]
    return "\n".join(cues)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("episode", help="episode number or slug")
    parser.add_argument("--track", action="append", default=[], metavar="PERSON=FILE", help="one per speaker")
    parser.add_argument("--mixed", action="store_true", help="use the published mix and detect speakers automatically")
    parser.add_argument("--no-speakers", action="store_true", help="with --mixed: skip speaker detection")
    parser.add_argument("--anchor", action="append", default=[], metavar="PERSON=SECONDS", help="a moment where PERSON is talking")
    parser.add_argument("--fresh", action="store_true", help="re-run Whisper even if cached")
    parser.add_argument("--model", default="mlx-community/whisper-large-v3-turbo")
    args = parser.parse_args()

    if bool(args.track) == args.mixed:
        parser.error("pass either --track PERSON=FILE (one per speaker) or --mixed")

    from mlx_whisper.audio import load_audio

    episode = load_episode(args.episode)
    prompt = vocabulary(episode)
    words: list[dict] = []
    source = "tracks"

    if args.mixed:
        source = "mixed"
        audio = load_audio(str(download(episode)))
        print(f"Transcribing published mix ({len(audio) / SAMPLE_RATE / 60:.1f} min)…")
        words = whisper_words(audio, args.model, prompt, False, CACHE / "whisper" / f"{episode['slug']}.json", args.fresh)
        ids = speakers_for(episode)
        if not args.no_speakers and len(ids) > 1:
            anchors = {}
            for spec in args.anchor:
                person, _, seconds = spec.partition("=")
                anchors[person] = float(seconds)
            diarize(audio, words, ids, anchors)
            source = "diarized"
        else:
            for word in words:
                word["sp"] = ids[0] if len(ids) == 1 else None
    else:
        for spec in args.track:
            person, _, path = spec.partition("=")
            file = Path(path).expanduser()
            if not person or not file.exists():
                parser.error(f"bad --track {spec!r} (expected person=existing/file)")
            audio = load_audio(str(file))
            drift = abs(len(audio) / SAMPLE_RATE - episode["duration"])
            print(f"Transcribing {person} ({len(audio) / SAMPLE_RATE / 60:.1f} min)…")
            if episode["duration"] and drift > 3:
                print(
                    f"  ⚠ {file.name} is {drift:.0f}s off the published episode length. Export stems from the "
                    "final edit, or timestamps won't line up with the player."
                )
            track_words = whisper_words(audio, args.model, prompt, True, None, True)
            # Drop words where this person's own track is essentially silent: that's Whisper
            # hearing the other host bleed through, or inventing words.
            for word in track_words:
                chunk = audio[int(word["start"] * SAMPLE_RATE) : int(word["end"] * SAMPLE_RATE)]
                if chunk.size and 20 * np.log10(np.sqrt(np.mean(chunk**2)) + 1e-9) > -45:
                    words.append({**word, "sp": person})
        words.sort(key=lambda word: word["start"])

    segments = to_lines(words)
    for segment in segments:
        segment["s"], segment["e"] = round(segment["s"], 2), round(segment["e"], 2)

    TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
    VTT_DIR.mkdir(parents=True, exist_ok=True)
    document = {
        "episode": episode["slug"],
        "source": source,
        "model": args.model,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "segments": [{"s": s["s"], "e": s["e"], "sp": s["sp"], "t": s["t"]} for s in segments],
    }
    out = TRANSCRIPTS / f"{episode['slug']}.json"
    out.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n")
    (VTT_DIR / f"{episode['slug']}.vtt").write_text(to_vtt(segments, people()))
    print(f"Wrote {len(segments)} lines → {out.relative_to(ROOT)} and public/transcripts/{episode['slug']}.vtt")
    print("Skim it for misheard names/titles; add repeat offenders to scripts/vocab.txt.")


if __name__ == "__main__":
    main()
