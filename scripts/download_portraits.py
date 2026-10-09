"""Download the player portraits (avatars) of Elvenar into static/portraits.

The game lists every asset in an assets manifest. Its URL changes with each game
release; find the current one in the browser DevTools (Network tab, filter
"assetsmanifest") while the game is open, then run:

    python scripts/download_portraits.py <assets manifest URL>

Files are saved without their content hash (portrait_aw1_f.png), and
portraits.json lists them with their size and groups (all, elves, humans...).
Files already downloaded are skipped, so re-running only fetches new portraits.
"""

import json
import re
import sys
import time
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

ASSETS_URL = "https://oxes.innogamescdn.com/frontend//assets/"
OUT_DIR = Path(__file__).resolve().parents[1] / "cauldron_optimizer/static/portraits"
HASH_RE = re.compile(r"-[0-9a-f]{32}(\.png)$")


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def pictures(node: Any) -> Iterator[dict[str, Any]]:
    """Every PICTURE entry below a manifest node."""
    if isinstance(node, dict):
        if node.get("type") == "PICTURE":
            yield node
        else:
            for child in node.values():
                yield from pictures(child)


def main(manifest_url: str) -> None:
    manifest = json.loads(fetch(manifest_url))
    player = manifest["common"]["gui"]["portraits"]["player"]

    # The "medium" group holds the same portraits at a smaller size (56px)
    portraits: dict[str, dict[str, Any]] = {}
    for group, node in player.items():
        if group == "medium":
            continue
        for pic in pictures(node):
            name = HASH_RE.sub(r"\1", pic["file"])
            entry = portraits.setdefault(
                name,
                {
                    "file": name,
                    "source": pic["file"],
                    "width": pic["width"],
                    "height": pic["height"],
                    "groups": [],
                },
            )
            entry["groups"].append(group)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    new = 0
    for name, entry in sorted(portraits.items()):
        target = OUT_DIR / name
        if target.exists():
            continue
        target.write_bytes(fetch(ASSETS_URL + entry["source"]))
        new += 1
        time.sleep(0.05)  # be gentle with the CDN

    index = sorted(portraits.values(), key=lambda e: e["file"])
    (OUT_DIR / "portraits.json").write_text(json.dumps(index, indent=1) + "\n")
    print(f"{len(portraits)} portraits, {new} downloaded now, in {OUT_DIR}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
