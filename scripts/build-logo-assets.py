#!/usr/bin/env python3
"""
Derive the site's logo assets from the master artwork in design/.

    python3 scripts/build-logo-assets.py

The master lives in design/ rather than assets/ on purpose: scripts/deploy.sh
rsyncs the whole of assets/ into the deploy, so a 1.4 MB source file sitting
there would be published to the site for no reason.

The master is already transparent, but it carries ~250px of empty margin on
every side, so used as-is the mark renders about 60% of the size its box
implies. Everything here trims to the real content bounds first.

Downscaling happens in halving steps rather than one jump: canvas' filter is a
bilinear-ish sample, and 1024 -> 64 in a single call throws away most of the
pixels and aliases the block edges badly.

There is no PIL, ImageMagick or cwebp on this machine, so the image work runs
in the headless Chromium from the Playwright cache — the same binary that takes
the product screenshots.
"""
import base64, json, pathlib, re, subprocess, sys, tempfile

CHROME = pathlib.Path.home() / (
    "Library/Caches/ms-playwright/chromium_headless_shell-1234/"
    "chrome-headless-shell-mac-arm64/chrome-headless-shell"
)

# Rotate the artwork's hue onto the site's brand purple.
#
# The master is cyan (~199 deg). The site's accent is --p-600 #6442d6 (~255
# deg), and that is not a preference: white-on-cyan measures 2.23:1, which is
# below even the 3.0 floor for UI, while white-on-purple is 6.38:1.
# builder/test/palettes.test.ts already rejects a brand colour that cannot
# carry its own button label — it was written after Midnight's ochre shipped a
# 2.22:1 label — so moving the *site* to cyan would fail the suite. Moving the
# logo costs three derived files and keeps the shading intact, because only the
# hue changes: each pixel's saturation and lightness are preserved.
#
# Set to 0 to keep the master's own colour.
HUE_SHIFT = 56

JOBS = [
    # name,               height, square, margin fraction of the long edge
    ("logo-mark.png",        512, False, 0.00),
    ("favicon.png",           64, True,  0.06),
    ("brand-glyph.png",       96, False, 0.00),
]

PROGRAM = """
const jobs = __JOBS__;
const HUE_SHIFT = __HUE_SHIFT__;

// Real content bounds — the source is padded with ~250px of nothing.
let x0 = w, y0 = h, x1 = -1, y1 = -1;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 2) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
}
const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
log('content', cw + 'x' + ch, 'at', x0 + ',' + y0, 'aspect', (cw / ch).toFixed(3));

// Trim once into its own canvas; every output derives from this.
const trim = document.createElement('canvas');
trim.width = cw; trim.height = ch;
const tctx = trim.getContext('2d', {willReadFrequently: true});
tctx.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);

// Recolour at full resolution, before any downscaling, so the resampling
// filter never has to blend two different hues together.
if (HUE_SHIFT !== 0) {
  const rgb2hsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const M = Math.max(r, g, b), m = Math.min(r, g, b), l = (M + m) / 2;
    if (M === m) return [0, 0, l];
    const dd = M - m;
    const s = l > 0.5 ? dd / (2 - M - m) : dd / (M + m);
    const hh = M === r ? ((g - b) / dd + (g < b ? 6 : 0))
             : M === g ? (b - r) / dd + 2
             :           (r - g) / dd + 4;
    return [hh * 60, s, l];
  };
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const hsl2rgb = (h, s, l) => {
    h = ((((h % 360) + 360) % 360)) / 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1/3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1/3)]
      .map(v => Math.round(v * 255));
  };
  const id = tctx.getImageData(0, 0, cw, ch);
  const t = id.data;
  let n = 0;
  for (let i = 0; i < t.length; i += 4) {
    if (t[i+3] === 0) continue;
    const [hh, ss, ll] = rgb2hsl(t[i], t[i+1], t[i+2]);
    const [r, g, b] = hsl2rgb(hh + HUE_SHIFT, ss, ll);
    t[i] = r; t[i+1] = g; t[i+2] = b;
    n++;
  }
  tctx.putImageData(id, 0, 0);
  log('hue-shifted', n, 'pixels by +' + HUE_SHIFT + ' deg');
}

function halveTo(from, fw, fh, tw, th) {
  // Repeated halving until one more would overshoot, then the final step.
  let cur = from, curW = fw, curH = fh;
  while (curW / 2 >= tw && curH / 2 >= th) {
    const nx = document.createElement('canvas');
    nx.width = Math.round(curW / 2); nx.height = Math.round(curH / 2);
    const c = nx.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, curW, curH, 0, 0, nx.width, nx.height);
    cur = nx; curW = nx.width; curH = nx.height;
  }
  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  const c = out.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(cur, 0, 0, curW, curH, 0, 0, tw, th);
  return out;
}

const results = {};
for (const [name, H, square, margin] of jobs) {
  const scale = H / ch;
  const markH = Math.round(H * (1 - 2 * margin));
  const markW = Math.round(cw * (markH / ch));
  const shrunk = halveTo(trim, cw, ch, markW, markH);

  const outW = square ? H : markW + (H - markH);
  const out = document.createElement('canvas');
  out.width = outW; out.height = H;
  const c = out.getContext('2d');
  c.clearRect(0, 0, outW, H);
  c.drawImage(shrunk, Math.round((outW - markW) / 2), Math.round((H - markH) / 2));
  results[name] = out.toDataURL('image/png').split(',')[1];
  log('  ' + name.padEnd(20), outW + 'x' + H, '(mark ' + markW + 'x' + markH + ')');
}
log('RESULTS' + JSON.stringify(results) + 'STLUSER');
"""


def main() -> int:
    here = pathlib.Path(__file__).resolve().parent
    repo = here.parent
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else repo / "design" / "logo-source.png"
    outdir = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else repo / "assets" / "images"
    outdir.mkdir(parents=True, exist_ok=True)
    b64 = base64.b64encode(src.read_bytes()).decode()
    program = (PROGRAM.replace("__JOBS__", json.dumps(JOBS))
                  .replace("__HUE_SHIFT__", json.dumps(HUE_SHIFT)))

    html = """<!doctype html><meta charset="utf-8"><body><pre id="o"></pre><script>
const LINES = [];
function log(...a) { LINES.push(a.join(' ')); }
const src = new Image();
src.onload = () => {
  const w = src.naturalWidth, h = src.naturalHeight;
  const probe = document.createElement('canvas');
  probe.width = w; probe.height = h;
  const pctx = probe.getContext('2d', {willReadFrequently: true});
  pctx.drawImage(src, 0, 0);
  const d = pctx.getImageData(0, 0, w, h).data;
  try { __PROGRAM__ } catch (e) { log('ERROR ' + (e && e.message)); }
  document.getElementById('o').textContent = 'LOGS' + LINES.join('\\n') + 'SGOL';
};
src.src = 'data:image/png;base64,__B64__';
</script></body>""".replace("__PROGRAM__", program).replace("__B64__", b64)

    with tempfile.TemporaryDirectory() as tmp:
        page = pathlib.Path(tmp) / "mk.html"
        page.write_text(html, encoding="utf-8")
        proc = subprocess.run(
            [str(CHROME), "--headless", "--disable-gpu",
             f"--user-data-dir={tmp}/profile",
             "--virtual-time-budget=40000", "--dump-dom", page.as_uri()],
            capture_output=True, text=True,
        )

    import html as H
    logs = re.search(r"LOGS(.*?)SGOL", proc.stdout, re.S)
    if not logs:
        raise SystemExit("no output from the renderer")
    text = H.unescape(logs.group(1))
    payload = re.search(r"RESULTS(.*?)STLUSER", text, re.S)
    print("\n".join(line for line in text.splitlines() if not line.startswith("RESULTS")))
    if not payload:
        raise SystemExit("no images came back")
    for name, data in json.loads(payload.group(1)).items():
        (outdir / name).write_bytes(base64.b64decode(data))
        print(f"    {name}  {(outdir / name).stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
