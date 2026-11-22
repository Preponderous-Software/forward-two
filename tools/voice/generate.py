#!/usr/bin/env python3
"""Voice the Forward Two river guide with Kokoro-82M.

Writes web/audio/guide/<id>-<n>.ogg (small mono Vorbis via ffmpeg, or soundfile without it) and web/audio/guide/index.json, a
manifest mapping each id to its clips:

    {"voice": "...", "lead": 0.35, "clips": {"forward": [{"file": "forward-1.ogg", "text": "Forward!",
     "dur": 0.61, "stress": 0.35}, ...], ...}}

Call clips (forward/back/left/right) are padded so the loudest moment of the first word, its stress, sits
LEAD seconds into the clip. The game starts a call clip LEAD seconds before its beat, so the stress lands
on the beat whatever the variant.

    /root/.venvs/kokoro/bin/python tools/voice/generate.py            # make missing clips
    /root/.venvs/kokoro/bin/python tools/voice/generate.py --force    # re-make every clip
    /root/.venvs/kokoro/bin/python tools/voice/generate.py --voice am_onyx --force

Kokoro-82M is Apache-2.0 (https://huggingface.co/hexgrad/Kokoro-82M). The clips are CC0.
Clips are made one at a time with a few threads, so it stays polite on a busy machine.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'web' / 'audio' / 'guide'
SR = 24000
LEAD = 0.35            # seconds from clip start to the stress of a call
TARGET_LUFS = -16.0
PEAK_CEIL = 10 ** (-1.0 / 20)
GEN_VERSION = 1

# id -> [(text, speed)]; the first of each call is the plain one, then calmer/urgent variants.
LINES = {
    'forward': [('Forward!', 1.05), ('Forward! Dig!', 1.15), ('Forward, hard!', 1.25)],
    'back':    [('Back paddle!', 1.05), ('Back! Back!', 1.2), ('Back paddle, now!', 1.2)],
    'left':    [('Left!', 1.05), ('Left, left!', 1.15), ('Hard left!', 1.2)],
    'right':   [('Right!', 1.05), ('Right, right!', 1.15), ('Hard right!', 1.2)],
    'enter':   [('Here we go, dig in!', 1.05), ('Rapid ahead, eyes up!', 1.05), ('Big water, stay with me!', 1.05)],
    'clean':   [('Clean line!', 1.0), ('Beautiful!', 0.95)],
    'swim':    [('Swimmer! Grab the boat!', 1.15)],
    'back_in': [('Got you, back in!', 1.05)],
    'falls':   [('Hold on!', 1.1)],
    'camp':    [("Camp's on the left bank.", 0.95)],
    'night':   [('Getting dark, find a camp.', 0.92)],
}
CALLS = {'forward', 'back', 'left', 'right'}


def synth(pipe, voice, text, speed):
    import numpy as np
    chunks = []
    for _, _, audio in pipe(text, voice=voice, speed=speed):
        if audio is not None:
            chunks.append(audio.numpy() if hasattr(audio, 'numpy') else np.asarray(audio))
    a = np.concatenate(chunks).astype('float32')
    env = np.abs(a) > 0.01
    if env.any():
        i0, i1 = int(np.argmax(env)), len(a) - int(np.argmax(env[::-1]))
        a = a[max(0, i0 - int(0.02 * SR)): min(len(a), i1 + int(0.08 * SR))]
    try:
        import pyloudnorm
        lufs = pyloudnorm.Meter(SR, block_size=0.2).integrated_loudness(a.astype('float64'))
        gain = 10 ** ((TARGET_LUFS - lufs) / 20) if np.isfinite(lufs) else 1.0
    except Exception:
        rms = float(np.sqrt(np.mean(a ** 2))) or 1.0
        gain = 10 ** (TARGET_LUFS / 20) / rms
    a = a * gain
    peak = float(np.max(np.abs(a)))
    if peak > PEAK_CEIL:
        a *= PEAK_CEIL / peak
    n = int(0.006 * SR); ramp = np.linspace(0, 1, n, dtype='float32')
    a[:n] *= ramp; a[-n:] *= ramp[::-1]
    return a


def stress_time(a):
    """Seconds into `a` of the loudest 20 ms frame within the first 0.5 s of speech (the first word's stress)."""
    import numpy as np
    hop = int(0.01 * SR); win = int(0.02 * SR)
    frames = max(1, min(len(a) - win, int(0.5 * SR)) // hop)
    rms = np.array([np.sqrt(np.mean(a[i * hop:i * hop + win] ** 2)) for i in range(frames)])
    return (int(np.argmax(rms)) * hop + win / 2) / SR


def encode(a, path, quality):
    """Mono Ogg Vorbis: ffmpeg's libvorbis when ffmpeg is installed, else libsndfile's own Vorbis encoder."""
    import soundfile as sf
    if not shutil.which('ffmpeg'):
        # libsndfile quality: compression_level 0 (best) .. 1 (smallest); map -q 1 to about 0.6
        sf.write(str(path), a, SR, format='OGG', subtype='VORBIS', compression_level=min(1.0, max(0.0, 0.7 - quality * 0.1)))
        return
    with tempfile.NamedTemporaryFile(suffix='.wav') as t:
        sf.write(t.name, a, SR, subtype='PCM_16')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', t.name, '-ac', '1', '-ar', str(SR),
                        '-c:a', 'libvorbis', '-q:a', str(quality), '-map_metadata', '-1', str(path)], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--voice', default='am_michael', help='Kokoro voice (default am_michael)')
    ap.add_argument('--force', action='store_true', help='re-make every clip')
    ap.add_argument('--threads', type=int, default=2)
    ap.add_argument('--quality', type=float, default=1, help='libvorbis -q:a (-1..10; default 1, about 45 kb/s)')
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / 'index.json'
    old = json.loads(mpath.read_text()) if mpath.exists() else {}
    old_meta = old.get('_meta', {})
    pipe = None
    import numpy as np
    clips = {}
    for cid, lines in LINES.items():
        clips[cid] = []
        for i, (text, speed) in enumerate(lines):
            name = f'{cid}-{i + 1}.ogg'
            f = OUT / name
            sig = hashlib.sha1(json.dumps([GEN_VERSION, args.voice, text, speed, args.quality, cid in CALLS, LEAD]).encode()).hexdigest()[:10]
            prev = old_meta.get(name)
            if not args.force and prev and prev.get('sig') == sig and f.exists():
                clips[cid].append(prev['entry']); continue
            if pipe is None:
                import warnings; warnings.filterwarnings('ignore')
                import torch
                torch.set_num_threads(args.threads)
                from kokoro import KPipeline
                pipe = KPipeline(lang_code=args.voice[0], repo_id='hexgrad/Kokoro-82M')
            a = synth(pipe, args.voice, text, speed)
            entry = {'file': name, 'text': text}
            if cid in CALLS:
                st = stress_time(a)
                if st < LEAD:  # pad so the stress sits at LEAD
                    a = np.concatenate([np.zeros(int((LEAD - st) * SR), dtype='float32'), a])
                    st = LEAD
                entry['stress'] = round(st, 3)
            entry['dur'] = round(len(a) / SR, 3)
            encode(a, f, args.quality)
            clips[cid].append(entry)
            old_meta[name] = {'sig': sig, 'entry': entry}
            print(f'made {name:14s} {entry["dur"]:5.2f}s  {f.stat().st_size / 1024:5.1f} KB  {text}', flush=True)
            mpath.write_text(json.dumps({**old, '_meta': old_meta}, indent=1) + '\n')  # resumable
    keep = {e['file'] for es in clips.values() for e in es}
    for f in OUT.glob('*.ogg'):
        if f.name not in keep: f.unlink()
    manifest = {'voice': f'Kokoro-82M {args.voice} (Apache-2.0); clips CC0', 'lead': LEAD, 'clips': clips,
                '_meta': {k: v for k, v in old_meta.items() if k in keep}}
    mpath.write_text(json.dumps(manifest, indent=1) + '\n')
    total = sum(f.stat().st_size for f in OUT.glob('*.ogg'))
    print(f'{len(keep)} clips, {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()
