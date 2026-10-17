"""Check rendered content in the fixed 1280x900 gear/ghost QA scene.

Requires Pillow 12. Recalibrate the crop before changing the fixture window or
layout: it deliberately excludes the world, toolbar and item icons.
"""
import json
import sys
from PIL import Image


def check(path):
    with Image.open(path) as image:
        width, height = image.size
        assert abs(width / height - 1280 / 900) < 0.01, "Capture the QA window at 1280x900"
        pane = image.convert("RGB").crop(
            (int(width * .38), int(height * .24), int(width * .78), int(height * .68))
        )
        pixels = sum(
            blue > red * 1.3 and green > red * 1.3 and green > 40 and blue > 55
            for red, green, blue in pane.get_flattened_data()
        )
    return {"image": path, "preview_pixels": pixels, "passed": pixels >= 1000}


if __name__ == "__main__":
    results = [check(path) for path in sys.argv[1:]]
    if not results:
        raise SystemExit("Pass native QA screenshots to check")
    print(json.dumps(results))
    raise SystemExit(0 if all(result["passed"] for result in results) else 1)
