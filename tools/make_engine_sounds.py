"""
Turns Bryce's Ferrari engine recordings into the small sound files in assets/audio/.

Plain Python 3 (no extra packages) plus macOS `afconvert`.
Usage:  python3 tools/make_engine_sounds.py "/path/to/Engine sounds ferrari"

For each gear clip and the idle clip it:
  1. converts to mono 24 kHz,
  2. finds the steadiest 2-second stretch (even loudness, not too quiet),
  3. blends the end into the start so it loops with no click,
  4. evens out the loudness so all gears play at the same level,
and writes a WAV (WAV, not AAC, because AAC adds silence at the start that breaks seamless loops).
The startup click is copied as it is (it plays once, so AAC is fine).
"""
import math, os, shutil, struct, subprocess, sys, tempfile, wave

SR = 24000
LOOP = 2.0          # seconds in each loop
FADE = 0.3          # seconds blended across the loop point
TARGET_RMS = 5200   # about -16 dBFS
FRAME = SR // 10    # 0.1 s loudness frames

CLIPS = {
    'ferrari-idle': 'engine idle sound',
    'ferrari-gear1': '1st gear', 'ferrari-gear2': '2nd gear', 'ferrari-gear3': '3rd gear',
    'ferrari-gear4': '4th gear', 'ferrari-gear5': '5th gear', 'ferrari-gear6': '6th gear',
}
STARTUP = ('ferrari-startup', 'Engine Click sound startup')


def read_mono(path, tmp):
    out = os.path.join(tmp, 'x.wav')
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{SR}', '-c', '1', path, out], check=True)
    with wave.open(out) as w:
        n = w.getnframes()
        return list(struct.unpack('<%dh' % n, w.readframes(n)))


def rms(x):
    return math.sqrt(sum(v * v for v in x) / max(1, len(x)))


def best_window(x, length):
    frames = [rms(x[i:i + FRAME]) for i in range(0, len(x) - FRAME, FRAME)]
    span = math.ceil(length * SR / FRAME)
    loudest = max(frames)
    best, at = None, 0
    for s in range(0, len(frames) - span + 1):
        f = frames[s:s + span]
        m = sum(f) / span
        sd = math.sqrt(sum((v - m) ** 2 for v in f) / span)
        score = sd / m + 0.5 * (1 - m / loudest)      # steady first, then loud
        if best is None or score < best:
            best, at = score, s
    return at * FRAME


def make_loop(x):
    L, X = round(LOOP * SR), round(FADE * SR)
    need = L + X
    start = min(best_window(x, LOOP + FADE), len(x) - need)
    seg = x[start:start + need]
    out = seg[:L]
    for i in range(X):                          # equal-power blend of the tail into the head
        t = i / X
        out[i] = seg[i] * math.sin(t * math.pi / 2) + seg[L + i] * math.cos(t * math.pi / 2)
    gain = TARGET_RMS / max(1, rms(out))
    peak = max(abs(v) for v in out) * gain
    if peak > 30000: gain *= 30000 / peak
    return [max(-32768, min(32767, int(round(v * gain)))) for v in out], start / SR


def write_wav(path, data):
    with wave.open(path, 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(struct.pack('<%dh' % len(data), *data))


def main(src):
    dst = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio')
    os.makedirs(dst, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, clip in CLIPS.items():
            data, at = make_loop(read_mono(os.path.join(src, clip + '.m4a'), tmp))
            write_wav(os.path.join(dst, name + '.wav'), data)
            print(f'{name}.wav  from {clip}.m4a at {at:.1f}s')
    shutil.copyfile(os.path.join(src, STARTUP[1] + '.m4a'), os.path.join(dst, STARTUP[0] + '.m4a'))
    print(f'{STARTUP[0]}.m4a  copied')


if __name__ == '__main__':
    main(sys.argv[1])
