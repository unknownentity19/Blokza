#!/usr/bin/env python3
"""
Render assets/og-image.png.

The social card is art, not a page: the wordmark and the domain are set into it
as pixels, so a rename means rebuilding it rather than editing it. This exists
because the last two renames rebuilt it by hand, which is both slow and easy to
get subtly wrong — the tracking on an all-caps wordmark is not something you
want to rediscover from a screenshot each time.

    python3 scripts/build-og-card.py

Inter is fetched once and cached next to this script, then embedded as a data
URI, so the render neither depends on the network being up at screenshot time
nor races the font swapping in. Chromium comes from the Playwright cache — the
same binary the product screenshots are taken with.

Change WORDMARK and DOMAIN, re-run, done.
"""

import base64
import pathlib
import re
import shutil
import subprocess
import sys

WORDMARK = "BLOKZA"
DOMAIN = "blokza.com"

# Matches the site's tokens in assets/css/base.css.
FG = "#181024"
MUTED = "#5b5470"
PURPLE = "#6442d6"

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
OUT = REPO / "assets" / "og-image.png"
LOGO = REPO / "assets" / "images" / "logo-mark.png"
FONT_CACHE = HERE / ".og-inter-latin.woff2"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"


def chromium() -> pathlib.Path:
    """The headless Chromium to render with."""
    cache = pathlib.Path.home() / "Library/Caches/ms-playwright"
    for shell in sorted(cache.glob("chromium_headless_shell-*/*/chrome-headless-shell"), reverse=True):
        return shell
    for name in ("chromium", "chrome", "google-chrome-stable"):
        found = shutil.which(name)
        if found:
            return pathlib.Path(found)
    chrome = pathlib.Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if chrome.exists():
        return chrome
    raise SystemExit("no Chromium found — install Playwright's browsers or Chrome")


def fetch(url: str) -> bytes:
    """
    GET over curl rather than urllib.

    Not a style choice: a python.org install whose `Install Certificates.command`
    has never been run has no CA bundle, and urllib fails the handshake against
    Google while curl — which uses the system trust store — succeeds.
    """
    done = subprocess.run(
        ["curl", "-sSfL", "--max-time", "40", "-A", UA, url],
        capture_output=True,
    )
    if done.returncode != 0:
        raise SystemExit(f"could not fetch {url}: {done.stderr.decode().strip()}")
    return done.stdout


def inter_latin() -> bytes:
    """Inter's latin subset, cached next to this script after the first run."""
    if FONT_CACHE.exists():
        return FONT_CACHE.read_bytes()
    css = fetch(
        "https://fonts.googleapis.com/css2"
        "?family=Inter:wght@400;500;600;700;800&display=swap"
    ).decode()
    # Google serves one @font-face block per subset; only latin is needed, and
    # taking the whole family would be roughly ten times the bytes.
    block = re.search(r"/\*\s*latin\s*\*/\s*@font-face\s*\{(.*?)\}", css, re.S)
    if not block:
        raise SystemExit("could not find the latin subset in Google's CSS")
    url = re.search(r"url\((https://[^)]+\.woff2)\)", block.group(1))
    if not url:
        raise SystemExit("could not find a woff2 URL in the latin block")
    data = fetch(url.group(1))
    FONT_CACHE.write_bytes(data)
    return data


def page(font_b64: str, logo_b64: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face {{
    font-family: 'InterEmbedded';
    src: url(data:font/woff2;base64,{font_b64}) format('woff2');
    font-weight: 100 900;
    font-display: block;
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  html, body {{ width: 1200px; height: 630px; }}
  body {{
    font-family: 'InterEmbedded', system-ui, sans-serif;
    background: #ffffff;
    position: relative;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }}
  /* The bloom sits off the top-right corner so only its falloff lands on the
     card; centring it inside puts a visible hot spot behind the headline. */
  .glow {{
    position: absolute;
    top: -300px; right: -220px;
    width: 720px; height: 720px;
    background: radial-gradient(circle,
      rgba(122,95,229,0.17) 0%,
      rgba(122,95,229,0.07) 34%,
      rgba(122,95,229,0.00) 64%);
  }}
  .card {{ position: absolute; inset: 0; padding: 76px 80px; }}

  .lockup {{ display: flex; align-items: center; gap: 14px; }}
  /* Taller than the wordmark's cap height on purpose: the mark is a portrait
     rectangle, so matching heights would leave it reading lighter than the
     type beside it. */
  .lockup img {{ display: block; height: 36px; width: auto; }}
  .lockup span {{
    font-size: 29px;
    font-weight: 800;
    /* The same 0.04em the nav's .brand-name uses, so the wordmark is tracked
       identically wherever it appears. All caps needs it positive. */
    letter-spacing: 0.04em;
    color: {FG};
    line-height: 1;
  }}

  .rule {{ width: 97px; height: 4px; background: {PURPLE}; margin-top: 84px; border-radius: 2px; }}

  h1 {{
    margin-top: 38px;
    font-size: 80px;
    line-height: 90px;
    font-weight: 800;
    letter-spacing: -0.028em;
    color: {FG};
    /* Sized so the line breaks before "it today." rather than after it — the
       alternative leaves a two-word stub on the second line. */
    max-width: 900px;
  }}
  h1 em {{ font-style: normal; color: {PURPLE}; }}

  .foot {{
    position: absolute;
    left: 80px; right: 80px; bottom: 64px;
    display: flex; align-items: flex-start; justify-content: space-between;
  }}
  .tagline {{ font-size: 22px; line-height: 34px; font-weight: 400; color: {MUTED}; }}
  .domain {{ font-size: 22px; font-weight: 500; color: {PURPLE}; letter-spacing: -0.005em; }}
</style></head>
<body>
  <div class="glow"></div>
  <div class="card">
    <div class="lockup">
      <img src="data:image/png;base64,{logo_b64}" alt="">
      <span>{WORDMARK}</span>
    </div>
    <div class="rule"></div>
    <h1>Design it visually. <em>Ship it today.</em></h1>
    <div class="foot">
      <div class="tagline">The visual website builder for teams<br>who care about craft.</div>
      <div class="domain">{DOMAIN}</div>
    </div>
  </div>
</body></html>
"""


def main() -> int:
    font_b64 = base64.b64encode(inter_latin()).decode()
    logo_b64 = base64.b64encode(LOGO.read_bytes()).decode()
    src = HERE / ".og-card.html"
    src.write_text(page(font_b64, logo_b64), encoding="utf-8")

    OUT.unlink(missing_ok=True)
    subprocess.run(
        [str(chromium()), "--headless",
         "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb",
         "--window-size=1200,630",
         f"--screenshot={OUT}",
         "--virtual-time-budget=4000",
         src.as_uri()],
        check=True, capture_output=True,
    )
    src.unlink(missing_ok=True)

    if not OUT.exists():
        raise SystemExit("Chromium produced no screenshot")
    print(f"    {OUT.relative_to(REPO)}: 1200x630, {OUT.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
