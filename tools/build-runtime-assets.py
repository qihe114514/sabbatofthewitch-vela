#!/usr/bin/env python3
"""Build the small runtime visual-asset set from an extracted source tree.

The source is intentionally configurable: the default is the current full
asset tree. --source must point at a dump containing bg/ev/sd folders or the
decoded archive folders. Output is written to a temporary tree and then
swapped into src/common atomically.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import tempfile
import zlib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
COMMON = ROOT / "src" / "common"
GENERATED = ROOT / "tools" / "generated"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_WIDTH = 232
MAX_HEIGHT = 520
CHARACTER_CANVAS_WIDTH = 212
CHARACTER_CANVAS_HEIGHT = 520
# Keep animated backgrounds below the watch's large contiguous-allocation
# threshold while retaining enough pixels for the 212px display.
BACKGROUND_WIDTH = 424
BACKGROUND_HEIGHT = 520
EVENT_MAX_WIDTH = 520
EVENT_MAX_HEIGHT = 520
EVENT_DEFAULT_COLORS = 128
EVENT_FALLBACK_COLORS = 64
STABLE_BACKGROUND_WIDTH = 318
STABLE_BACKGROUND_HEIGHT = 390
STABLE_EVENT_MAX_WIDTH = 416
STABLE_EVENT_MAX_HEIGHT = 416
RPK_BUDGET = 15_000_000
SD_MEAN_DIFF_MAX = 3
SD_CHANNEL_DIFF_MAX = 8

PROFILE_PATH = ROOT / "tools" / "device-profile.json"
if PROFILE_PATH.exists():
    _profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    BACKGROUND_WIDTH, BACKGROUND_HEIGHT = _profile.get("background", [BACKGROUND_WIDTH, BACKGROUND_HEIGHT])
    EVENT_MAX_WIDTH, EVENT_MAX_HEIGHT = _profile.get("eventMax", [EVENT_MAX_WIDTH, EVENT_MAX_HEIGHT])
    CHARACTER_CANVAS_WIDTH, CHARACTER_CANVAS_HEIGHT = _profile.get("characterCanvas", [CHARACTER_CANVAS_WIDTH, CHARACTER_CANVAS_HEIGHT])


def scenario_refs() -> tuple[set[str], set[str], set[str], set[str]]:
    bg: set[str] = set()
    visual: set[str] = set()
    chars: set[str] = set()
    direct_sd: set[str] = set()
    for file in sorted((COMMON / "scn").glob("*.txt")):
        for node in json.loads(file.read_text(encoding="utf-8")):
            if not isinstance(node, list) or len(node) < 2:
                continue
            if node[0] == 2 and node[1]:
                bg.add(str(node[1]))
            elif node[0] == 5 and node[1]:
                visual.add(str(node[1]))
                if str(node[1]).startswith("sd"):
                    direct_sd.add(str(node[1]))
            elif node[0] == 3 and isinstance(node[3] if len(node) > 3 else None, list):
                for entry in node[3]:
                    if isinstance(entry, list) and entry and entry[0]:
                        name = str(entry[0])
                        chars.add("|".join([name, str(entry[2] or "") if len(entry) > 2 else "", str(entry[3] or "") if len(entry) > 3 else ""]))
    return bg, visual, chars, direct_sd


def index_files(sources: list[Path]) -> dict[str, list[Path]]:
    roots: list[tuple[str | None, Path]] = []
    direct_names = {"bg": "bg", "bgimage": "bg", "ev": "ev", "evimage": "ev", "sd": "sd", "fgimage": "sd", "overlay": "overlay"}
    for source in sources:
        for name, category in direct_names.items():
            candidate = source / name
            if candidate.is_dir():
                roots.append((category, candidate))
        for name in ("sanoba_raw", "sanoba_ev_layers", "sanoba_visual_decoded", "sanoba_visual_raw"):
            candidate = source / name
            if candidate.is_dir():
                roots.append((None, candidate))
        if source.is_dir():
            roots.append((None, source))
    result: dict[str, list[Path]] = {k: [] for k in ("bg", "ev", "sd", "overlay")}
    for forced_category, root in roots:
        for file in root.rglob("*") if root.exists() else []:
            if not file.is_file() or file.suffix.lower() not in IMAGE_EXTS:
                continue
            low = str(file).lower()
            category = forced_category or ("ev" if "evimage" in low or f"{os.sep}ev{os.sep}" in low or "ev_layers" in low else "sd" if f"{os.sep}sd{os.sep}" in low or "fgimage" in low else "overlay" if "overlay" in low else "bg")
            result[category].append(file)
    for category, values in result.items():
        unique = {str(path.resolve()): path for path in values}
        result[category] = list(unique.values())
        result[category].sort(key=lambda p: (p.stat().st_size, str(p)), reverse=True)
    return result


def by_stem(files: list[Path]) -> dict[str, list[Path]]:
    result: dict[str, list[Path]] = {}
    for file in files:
        result.setdefault(file.stem.casefold(), []).append(file)
    return result


def pick_exact(name: str, indexes: dict[str, dict[str, list[Path]]]) -> Path | None:
    for category in ("bg", "sd", "ev", "overlay"):
        values = indexes[category].get(name.casefold())
        if values:
            return values[0]
    return None


def pick_containing(fragment: str, files: dict[str, list[Path]]) -> Path | None:
    needle = fragment.casefold()
    candidates = [path for values in files.values() for path in values if needle in path.stem.casefold()]
    return sorted(candidates, key=lambda path: (path.stat().st_size, str(path)), reverse=True)[0] if candidates else None


def quantize_png(image: Image.Image, target: Path, colors: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    image.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
        target, "PNG", optimize=True, compress_level=9
    )


def fit_cover(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / image.width, height / image.height)
    resized = image.resize((max(width, round(image.width * scale)), max(height, round(image.height * scale))), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - width) // 2)
    top = max(0, (resized.height - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def fit_event(image: Image.Image) -> Image.Image:
    if image.width >= image.height:
        width = EVENT_MAX_WIDTH
        height = max(1, round(width * image.height / image.width))
        if height > EVENT_MAX_HEIGHT:
            height = EVENT_MAX_HEIGHT
            width = max(1, round(height * image.width / image.height))
    else:
        height = EVENT_MAX_HEIGHT
        width = max(1, round(height * image.width / image.height))
        if width > EVENT_MAX_WIDTH:
            width = EVENT_MAX_WIDTH
            height = max(1, round(width * image.height / image.width))
    if image.size == (width, height):
        return image
    return image.resize((width, height), Image.Resampling.LANCZOS)


def convert(source: Path, target: Path, kind: str, colors: int | None = None) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image.load()
        if kind == "bg":
            rgb = fit_cover(image.convert("RGB"), BACKGROUND_WIDTH, BACKGROUND_HEIGHT)
            target.parent.mkdir(parents=True, exist_ok=True)
            rgb.quantize(colors=colors or EVENT_DEFAULT_COLORS, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(
                target, "PNG", optimize=True, compress_level=9
            )
        elif kind == "ev":
            rgba = image.convert("RGBA")
            canvas = Image.new("RGB", rgba.size, (0, 0, 0))
            canvas.paste(rgba, mask=rgba.getchannel("A"))
            quantize_png(fit_event(canvas), target, colors or EVENT_DEFAULT_COLORS)
        else:
            rgba = fit_bounds(image.convert("RGBA"))
            rgba.quantize(colors=16, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(target, "PNG", optimize=True)


def fit_bounds(image: Image.Image, max_width: int = MAX_WIDTH, max_height: int = MAX_HEIGHT) -> Image.Image:
    if image.width <= max_width and image.height <= max_height:
        return image
    scale = min(max_width / image.width, max_height / image.height)
    return image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)


def image_size(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            return image.size
    except Exception:
        return (0, 0)


def normalized_name(value: str) -> str:
    return str(value or "").replace("\\", "/").split("/")[-1].strip().casefold()


def decode_asset_text(path: Path) -> str:
    data = path.read_bytes()
    marker = data.find(b"\x78\x9c")
    if marker >= 0 and path.suffix.casefold() == ".txt" and data[:4] == b"\xfe\xfe\x02\xff":
        return zlib.decompress(data[marker:]).decode("utf-16le", errors="replace")
    for encoding in ("utf-8", "cp932"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def parse_layer_metadata(path: Path) -> dict:
    rows = list(csv.reader(decode_asset_text(path).splitlines(), delimiter="\t"))
    canvas = (0, 0)
    if len(rows) > 1 and len(rows[1]) > 5:
        canvas = (int(rows[1][4] or 0), int(rows[1][5] or 0))
    layers = {}
    for row in rows[2:]:
        if len(row) < 10 or not row[1]:
            continue
        try:
            layers.setdefault(normalized_name(row[1]), {
                "name": row[1], "left": int(row[2]), "top": int(row[3]),
                "width": int(row[4]), "height": int(row[5]), "id": int(row[9])
            })
        except ValueError:
            continue
    return {"canvas": canvas, "layers": layers}


def parse_character_info(path: Path) -> dict:
    dresses = {}
    faces = {}
    for raw in decode_asset_text(path).splitlines():
        row = raw.split("\t")
        if len(row) < 4 or not row[0] or row[0].startswith("#"):
            continue
        if row[0].casefold() == "dress" and len(row) >= 5:
            dresses.setdefault(row[1].strip(), {}).setdefault(row[3].strip(), []).append(row[4].strip())
        elif row[0].casefold() == "face" and len(row) >= 4:
            faces.setdefault(row[1].strip().casefold(), []).append(row[3].strip())
    return {"dresses": dresses, "faces": faces}


def character_metadata(sources: list[Path], sd_files: list[Path]) -> dict[str, list[dict]]:
    images = {p.stem: p for p in sd_files if "_0_" not in p.stem}
    result = {}
    roots = [p for source in sources for p in source.rglob("*_info.txt")]
    for info_path in roots:
        base = info_path.name[:-9]
        layer_path = info_path.with_name(f"{base}.txt")
        if not layer_path.exists():
            continue
        metadata = parse_layer_metadata(layer_path)
        info = parse_character_info(info_path)
        if not metadata["canvas"] or not metadata["layers"]:
            continue
        metadata.update({"base": base, "directory": info_path.parent, **info, "images": images})
        result.setdefault(base.rstrip("ab"), []).append(metadata)
    for values in result.values():
        values.sort(key=lambda item: item["base"])
    return result


def find_layer(metadata: dict, name: str) -> dict | None:
    return metadata["layers"].get(normalized_name(name))


def layer_image(metadata: dict, layer: dict) -> Path | None:
    exact = metadata["images"].get(f"{metadata['base']}_{layer['id']}")
    if exact:
        return exact
    candidate = metadata["directory"] / f"{metadata['base']}_{layer['id']}.png"
    return candidate if candidate.exists() else None


def compose_layer_canvas(metadata: dict, layers: list[dict], alpha: bool = True) -> Image.Image:
    width, height = metadata["canvas"]
    canvas = Image.new("RGBA" if alpha else "RGB", (width, height), (0, 0, 0, 0) if alpha else (0, 0, 0))
    for layer in layers:
        source_path = layer_image(metadata, layer)
        if not source_path:
            continue
        with Image.open(source_path) as source:
            overlay = source.convert("RGBA")
            canvas.alpha_composite(overlay, (layer["left"], layer["top"]))
    return canvas


def make_character_canvas(canvas: Image.Image, crop: tuple[int, int, int, int] | None = None) -> Image.Image:
    if crop is None:
        crop = canvas.getchannel("A").getbbox() or (0, 0, canvas.width, canvas.height)
    image = fit_bounds(canvas.crop(crop), CHARACTER_CANVAS_WIDTH, CHARACTER_CANVAS_HEIGHT)
    result = Image.new("RGBA", (CHARACTER_CANVAS_WIDTH, CHARACTER_CANVAS_HEIGHT), (0, 0, 0, 0))
    left = max(0, (CHARACTER_CANVAS_WIDTH - image.width) // 2)
    top = max(0, CHARACTER_CANVAS_HEIGHT - image.height)
    result.alpha_composite(image, (left, top))
    return result


def save_character_canvas(canvas: Image.Image, target: Path, crop: tuple[int, int, int, int] | None = None) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    make_character_canvas(canvas, crop).quantize(colors=16, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(target, "PNG", optimize=True)


def describe_character_asset(path: Path) -> dict:
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        bbox = rgba.getchannel("A").getbbox()
        return {
            "size": list(rgba.size),
            "alphaBBox": list(bbox) if bbox else [],
            "visibleCenterX": round(((bbox[0] + bbox[2]) / 2) if bbox else rgba.width / 2, 2),
            "visibleBottom": bbox[3] if bbox else 0,
        }


def _sd_contexts(mapping: dict[str, str]) -> dict[str, tuple[tuple[str, str], ...]]:
    contexts: dict[str, set[tuple[str, str]]] = {}
    for key, value in mapping.items():
        if not isinstance(value, str) or not value.startswith("/common/sd/"):
            continue
        parts = key.split("|", 2)
        if len(parts) == 3:
            contexts.setdefault(value, set()).add((parts[0], parts[2]))
    return {path: tuple(sorted(values)) for path, values in contexts.items()}


def _sd_image_diff(left: Image.Image, right: Image.Image) -> tuple[float, int]:
    if left.size != right.size:
        return float("inf"), 255
    a = list(left.convert("RGBA").getdata())
    b = list(right.convert("RGBA").getdata())
    diffs: list[int] = []
    maximum = 0
    for pa, pb in zip(a, b):
        if pa[3] != pb[3]:
            return float("inf"), 255
        if pa[3] == 0:
            continue
        for ca, cb in zip(pa[:3], pb[:3]):
            value = abs(ca - cb)
            diffs.append(value)
            maximum = max(maximum, value)
    return (sum(diffs) / len(diffs) if diffs else 0.0), maximum


def _sd_sample_diff(left: Image.Image, right: Image.Image) -> tuple[float, int]:
    return _sd_image_diff(
        left.resize((16, 16), Image.Resampling.NEAREST),
        right.resize((16, 16), Image.Resampling.NEAREST),
    )


def _sd_signature(image: Image.Image) -> tuple:
    rgba = image.convert("RGBA")
    alpha = bytes(pixel[3] for pixel in rgba.getdata())
    sample = list(rgba.resize((16, 16), Image.Resampling.NEAREST).getdata())
    mean = tuple(sum(pixel[i] for pixel in sample) // len(sample) for i in range(3))
    return rgba.size, hashlib.sha1(alpha).digest(), tuple(value // 4 for value in mean)


def merge_similar_sd_assets(sd_dir: Path, body_map: dict[str, str], face_map: dict[str, str]) -> dict:
    contexts = _sd_contexts(body_map)
    for path, values in _sd_contexts(face_map).items():
        contexts[path] = tuple(sorted(set(contexts.get(path, ())) | set(values)))
    groups: dict[tuple[str, tuple[tuple[str, str], ...]], list[Path]] = {}
    for path_text, role_contexts in contexts.items():
        path = sd_dir / path_text.rsplit("/", 1)[-1]
        if path.is_file():
            kind = "face" if path.name.endswith("_face.png") else "body"
            groups.setdefault((kind, role_contexts), []).append(path)
    replacements: dict[str, str] = {}
    merged_groups = []
    for (kind, role_contexts), paths in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1])):
        representatives: dict[tuple, list[tuple[Path, Image.Image]]] = {}
        for path in sorted(paths, key=lambda item: item.name):
            with Image.open(path) as image:
                image.load()
                candidate = image.convert("RGBA")
                match = None
                bucket = representatives.setdefault(_sd_signature(candidate), [])
                for representative, reference in bucket:
                    sample_mean, sample_max = _sd_sample_diff(candidate, reference)
                    if sample_mean > SD_MEAN_DIFF_MAX or sample_max > SD_CHANNEL_DIFF_MAX:
                        continue
                    mean_diff, max_diff = _sd_image_diff(candidate, reference)
                    if mean_diff <= SD_MEAN_DIFF_MAX and max_diff <= SD_CHANNEL_DIFF_MAX:
                        match = representative, mean_diff, max_diff
                        break
                if match:
                    representative, mean_diff, max_diff = match
                    replacements[f"/common/sd/{path.name}"] = f"/common/sd/{representative.name}"
                    merged_groups.append({"kind": kind, "contexts": [list(v) for v in role_contexts], "representative": representative.name, "merged": path.name, "meanDiff": round(mean_diff, 4), "maxDiff": max_diff})
                else:
                    bucket.append((path, candidate.copy()))
    for mapping in (body_map, face_map):
        for key, value in list(mapping.items()):
            mapping[key] = replacements.get(value, value)
    for old in replacements:
        target = sd_dir / old.rsplit("/", 1)[-1]
        if target.exists():
            target.unlink()
    return {"threshold": {"meanDiffMax": SD_MEAN_DIFF_MAX, "channelDiffMax": SD_CHANNEL_DIFF_MAX}, "originalFiles": len(list(sd_dir.glob("*.png"))) + len(replacements), "representativeFiles": len(list(sd_dir.glob("*.png"))), "mergedFiles": len(replacements), "mergedGroups": merged_groups}


def compose_precise_body(metadata: dict, costume: str, target: Path) -> tuple[bool, tuple[int, int, int, int] | None]:
    dress_name = next((name for name in metadata["dresses"] if name.casefold() == costume.casefold()), None)
    if dress_name is None:
        return False, None
    diffs = metadata["dresses"][dress_name]
    diff_names = diffs.get("1") or diffs[sorted(diffs)[0]]
    body_layers = [layer for name in diff_names if (layer := find_layer(metadata, name))]
    if not body_layers:
        return False, None
    body_canvas = compose_layer_canvas(metadata, body_layers)
    crop = body_canvas.getchannel("A").getbbox()
    if not crop:
        return False, None
    save_character_canvas(body_canvas, target, crop)
    return True, crop


def compose_precise_character(metadata: dict, costume: str, expression: str, body_target: Path, face_target: Path | None) -> bool:
    ok, crop = compose_precise_body(metadata, costume, body_target)
    if not ok:
        return False
    if face_target:
        compose_precise_face(metadata, expression, face_target, crop)
    return True


def compose_precise_face(metadata: dict, expression: str, target: Path, crop: tuple[int, int, int, int] | None = None) -> bool:
    face_names = metadata["faces"].get(expression.casefold())
    if not face_names:
        base_expression = re.sub(r"[hdern]$", "", expression.casefold())
        face_names = metadata["faces"].get(base_expression)
    face_layers = [layer for name in (face_names or []) if (layer := find_layer(metadata, name))]
    if not face_layers:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    save_character_canvas(compose_layer_canvas(metadata, face_layers), target, crop)
    return True


def atomic_swap(temp: Path, destination: Path) -> None:
    backup = destination.with_name(destination.name + ".previous")
    if backup.exists():
        shutil.rmtree(backup)
    destination.rename(backup)
    try:
        temp.rename(destination)
    except Exception:
        backup.rename(destination)
        raise
    shutil.rmtree(backup)


def rebuild_backgrounds() -> int:
    """Rebuild only runtime backgrounds from the current canonical PNGs."""
    bg_refs, _, _, _ = scenario_refs()
    runtime_bg_indexes = by_stem(index_files([COMMON / "bg"])['bg'])
    temp_parent = Path(tempfile.mkdtemp(prefix="runtime-bg-", dir=str(ROOT / "tools")))
    out = temp_parent / "common" / "bg"
    try:
        for name in sorted(bg_refs):
            candidates = runtime_bg_indexes.get(name.casefold(), [])
            if not candidates:
                raise RuntimeError(f"missing runtime background: {name}")
            convert(candidates[0], out / f"{name}.png", "bg")
        atomic_swap(out, COMMON / "bg")
        print(f"runtime backgrounds rebuilt: {len(bg_refs)}")
        return 0
    finally:
        shutil.rmtree(temp_parent, ignore_errors=True)


def runtime_tree_size(root: Path) -> int:
    return sum(path.stat().st_size for path in root.rglob("*") if path.is_file())


def _manifest_paths(manifest: dict) -> set[str]:
    paths = set()
    def visit(value):
        if isinstance(value, str) and value.startswith("/common/"):
            paths.add(value)
        elif isinstance(value, dict):
            for child in value.values(): visit(child)
    visit(manifest)
    return paths


def prune_runtime_assets(root: Path, manifest: dict, body_map: dict, face_map: dict, backup_name: str = "unused-assets-backup") -> dict:
    referenced = _manifest_paths(manifest)
    referenced.update(value for value in body_map.values() if isinstance(value, str))
    referenced.update(value for value in face_map.values() if isinstance(value, str))
    removed = []
    for folder in ("bg", "sd", "ev", "overlay"):
        directory = root / folder
        for path in sorted(directory.glob("*.png")) if directory.exists() else []:
            runtime_path = "/common/" + folder + "/" + path.name
            if runtime_path not in referenced:
                removed.append(runtime_path)
                path.unlink()
    return {"referencedFiles": len(referenced), "removedFiles": removed, "removedCount": len(removed)}


def audit_existing_runtime_assets() -> int:
    manifest_file = COMMON / "runtime" / "resource-manifest.txt"
    body_file = GENERATED / "character-map.generated.json"
    face_file = GENERATED / "character-face-map.generated.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8")) if manifest_file.exists() else {"paths": {}}
    body_map = json.loads(body_file.read_text(encoding="utf-8")) if body_file.exists() else {}
    face_map = json.loads(face_file.read_text(encoding="utf-8")) if face_file.exists() else {}
    referenced = _manifest_paths(manifest) | {value for value in body_map.values() if isinstance(value, str)} | {value for value in face_map.values() if isinstance(value, str)}
    backup = ROOT / "tools" / "unused-assets-backup-audit"
    backup.mkdir(parents=True, exist_ok=True)
    moved = []
    for folder in ("bg", "sd", "ev", "overlay"):
        directory = COMMON / folder
        for path in sorted(directory.glob("*.png")) if directory.exists() else []:
            runtime_path = "/common/" + folder + "/" + path.name
            if runtime_path not in referenced:
                shutil.move(str(path), str(backup / f"{folder}__{path.name}"))
                moved.append(runtime_path)
    report = {"referencedFiles": len(referenced), "movedFiles": moved, "movedCount": len(moved), "backupDirectory": str(backup)}
    GENERATED.mkdir(parents=True, exist_ok=True)
    (GENERATED / "resource-prune-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"runtime resource audit: moved={len(moved)} backup={backup}")
    return 0


def repack_runtime(requested_colors: str = "auto", install_stable: bool = False) -> int:
    """Re-encode the existing runtime visuals at screen-sized PNG canvases."""
    temp_parent = Path(tempfile.mkdtemp(prefix="runtime-repack-", dir=str(ROOT / "tools")))
    old_dimensions = (globals()["BACKGROUND_WIDTH"], globals()["BACKGROUND_HEIGHT"], globals()["EVENT_MAX_WIDTH"], globals()["EVENT_MAX_HEIGHT"])
    if install_stable:
        globals()["BACKGROUND_WIDTH"] = STABLE_BACKGROUND_WIDTH
        globals()["BACKGROUND_HEIGHT"] = STABLE_BACKGROUND_HEIGHT
        globals()["EVENT_MAX_WIDTH"] = STABLE_EVENT_MAX_WIDTH
        globals()["EVENT_MAX_HEIGHT"] = STABLE_EVENT_MAX_HEIGHT
    candidates: dict[int, Path] = {}
    try:
        choices = [EVENT_DEFAULT_COLORS, EVENT_FALLBACK_COLORS] if requested_colors == "auto" else [int(requested_colors)]
        for colors in choices:
            candidate = temp_parent / str(colors)
            candidates[colors] = candidate
            for folder, kind in (("bg", "bg"), ("ev", "ev")):
                source_dir = COMMON / folder
                target_dir = candidate / folder
                for source in sorted(source_dir.rglob("*.png")):
                    convert(source, target_dir / source.relative_to(source_dir), kind, colors)
            for folder in ("sd", "overlay"):
                source_dir = COMMON / folder
                target_dir = candidate / folder
                for source in sorted(source_dir.rglob("*")):
                    if source.is_file():
                        target = target_dir / source.relative_to(source_dir)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(source, target)

        rpk_files = sorted((ROOT / "dist").glob("*.rpk"), key=lambda path: path.stat().st_mtime, reverse=True)
        current_rpk = rpk_files[0].stat().st_size if rpk_files else 0
        current_common = runtime_tree_size(ROOT / "build" / "common") if (ROOT / "build" / "common").exists() else runtime_tree_size(COMMON)
        fixed_bytes = max(0, current_rpk - current_common)
        selected = None
        estimates = {}
        for colors in choices:
            estimate = fixed_bytes + runtime_tree_size(candidates[colors])
            estimates[str(colors)] = estimate
            if selected is None and estimate <= round(RPK_BUDGET * 0.82):
                selected = colors
        if selected is None:
            selected = EVENT_FALLBACK_COLORS if EVENT_FALLBACK_COLORS in candidates else choices[-1]
        chosen = candidates[selected]
        for folder in ("bg", "ev", "sd", "overlay"):
            atomic_swap(chosen / folder, COMMON / folder)
        report = {
            "budgetBytes": RPK_BUDGET,
            "requestedColors": requested_colors,
            "selectedColors": selected,
            "estimatedRpkBytes": estimates.get(str(selected), 0),
            "estimates": estimates,
            "folders": {folder: {"files": len(list((COMMON / folder).rglob("*.png"))), "bytes": runtime_tree_size(COMMON / folder)} for folder in ("bg", "sd", "ev", "overlay")},
        }
        GENERATED.mkdir(parents=True, exist_ok=True)
        (GENERATED / "runtime-quality-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report["installStable"] = install_stable
        (GENERATED / "runtime-quality-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"runtime visuals repacked: colors={selected} stable={install_stable} estimated-rpk={report['estimatedRpkBytes']} bytes")
        return 0
    finally:
        globals()["BACKGROUND_WIDTH"], globals()["BACKGROUND_HEIGHT"], globals()["EVENT_MAX_WIDTH"], globals()["EVENT_MAX_HEIGHT"] = old_dimensions
        shutil.rmtree(temp_parent, ignore_errors=True)


def merge_existing_sd() -> int:
    body_file = GENERATED / "character-map.generated.json"
    face_file = GENERATED / "character-face-map.generated.json"
    metadata_file = GENERATED / "character-layer-metadata.generated.json"
    body_map = json.loads(body_file.read_text(encoding="utf-8"))
    face_map = json.loads(face_file.read_text(encoding="utf-8"))
    metadata = json.loads(metadata_file.read_text(encoding="utf-8")) if metadata_file.exists() else {}
    report = merge_similar_sd_assets(COMMON / "sd", body_map, face_map)
    report["bytes"] = sum(path.stat().st_size for path in (COMMON / "sd").glob("*.png"))
    for key, value in metadata.items():
        value["body"] = body_map.get(key, value.get("body", ""))
        value["face"] = face_map.get(key, "")
    body_file.write_text(json.dumps(body_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    face_file.write_text(json.dumps(face_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    metadata_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (COMMON / "character-map.js").write_text("// Generated by npm run build:assets.\nexport default " + json.dumps(body_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (COMMON / "character-face-map.js").write_text("// Generated by npm run build:assets.\nexport default " + json.dumps(face_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (GENERATED / "sd-merge-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"sd assets merged: files={report['originalFiles']}->{report['representativeFiles']} merged={report['mergedFiles']} bytes={report['bytes']}")
    return 0


def center_existing_sd() -> int:
    body_file = GENERATED / "character-map.generated.json"
    face_file = GENERATED / "character-face-map.generated.json"
    metadata_file = GENERATED / "character-layer-metadata.generated.json"
    body_map = json.loads(body_file.read_text(encoding="utf-8"))
    face_map = json.loads(face_file.read_text(encoding="utf-8"))
    metadata = json.loads(metadata_file.read_text(encoding="utf-8")) if metadata_file.exists() else {}
    sources = sorted(COMMON.joinpath("sd").glob("*.png"), key=lambda path: path.name)
    temp_parent = Path(tempfile.mkdtemp(prefix="center-sd-", dir=str(ROOT / "tools")))
    out = temp_parent / "sd"
    try:
        asset_meta = {}
        before_bytes = sum(path.stat().st_size for path in sources)
        for source in sources:
            with Image.open(source) as image:
                centered = make_character_canvas(image.convert("RGBA"))
                target = out / source.name
                target.parent.mkdir(parents=True, exist_ok=True)
                centered.quantize(colors=16, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(target, "PNG", optimize=True)
            asset_meta[source.name] = describe_character_asset(target)
        after_bytes = sum(path.stat().st_size for path in out.glob("*.png"))
        atomic_swap(out, COMMON / "sd")
        for key in sorted(set(body_map) | set(face_map)):
            entry = metadata.setdefault(key, {})
            body = body_map.get(key, entry.get("body", ""))
            face = face_map.get(key, entry.get("face", ""))
            entry["body"] = body
            entry["face"] = face
            entry["bodyAsset"] = asset_meta.get(Path(body).name, {}) if body else {}
            entry["faceAsset"] = asset_meta.get(Path(face).name, {}) if face else {}
        report = {
            "canvas": [CHARACTER_CANVAS_WIDTH, CHARACTER_CANVAS_HEIGHT],
            "colors": 16,
            "files": len(sources),
            "beforeBytes": before_bytes,
            "afterBytes": after_bytes,
            "assetMeta": asset_meta,
        }
        GENERATED.mkdir(parents=True, exist_ok=True)
        metadata_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (GENERATED / "character-layout-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"sd assets centered: files={len(sources)} bytes={before_bytes}->{after_bytes} canvas={CHARACTER_CANVAS_WIDTH}x{CHARACTER_CANVAS_HEIGHT}")
        return 0
    finally:
        shutil.rmtree(temp_parent, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, nargs="*", default=[], help="external decoded export roots")
    parser.add_argument("--background-only", action="store_true", help="rebuild only canonical runtime backgrounds")
    parser.add_argument("--merge-existing-sd", action="store_true", help="merge existing generated sd assets and mappings")
    parser.add_argument("--center-existing-sd", action="store_true", help="center existing body/face PNGs on a shared watch canvas")
    parser.add_argument("--repack-runtime", action="store_true", help="re-encode existing runtime visuals at screen-sized PNG canvases")
    parser.add_argument("--install-stable", action="store_true", help="use reduced decode dimensions for device installation stability")
    parser.add_argument("--audit-existing-runtime", action="store_true", help="audit current runtime assets and move unreferenced PNGs to a backup")
    parser.add_argument("--colors", choices=("auto", "128", "64"), default="auto", help="palette budget for runtime visuals")
    args = parser.parse_args()
    if args.background_only:
        return rebuild_backgrounds()
    if args.merge_existing_sd:
        return merge_existing_sd()
    if args.center_existing_sd:
        return center_existing_sd()
    if args.repack_runtime:
        return repack_runtime(args.colors, args.install_stable)
    if args.audit_existing_runtime:
        return audit_existing_runtime_assets()
    sources = [source.resolve() for source in args.source]
    if not sources:
        raise RuntimeError("--source is required unless --merge-existing-sd is used")
    missing_sources = [source for source in sources if not source.is_dir()]
    if missing_sources:
        raise RuntimeError("source directory does not exist: " + ", ".join(str(source) for source in missing_sources))
    bg_refs, visual_refs, character_refs, direct_sd = scenario_refs()
    files = index_files(sources)
    indexes = {category: by_stem(values) for category, values in files.items()}
    runtime_bg_indexes = by_stem(index_files([COMMON / "bg"])['bg'])
    runtime_ev_indexes = by_stem(index_files([COMMON / "ev"])['ev'])

    temp_parent = Path(tempfile.mkdtemp(prefix="runtime-assets-", dir=str(ROOT / "tools")))
    out = temp_parent / "common"
    paths = {"bg": {}, "sd": {}, "ev": {}, "overlay": {}}
    try:
        for name in sorted(bg_refs):
            src = runtime_bg_indexes.get(name.casefold(), [None])[0] or pick_exact(name, indexes)
            if not src:
                raise RuntimeError(f"missing background source: {name}")
            target_name = f"{name}.png"
            convert(src, out / "bg" / target_name, "bg")
            paths["bg"][name] = f"/common/bg/{target_name}"

        # Build shared body/face PNG layers. Both are rendered from the same
        # source canvas and exact crop, so the watch can stack them without
        # independent scaling or positional drift.
        character_map = {}
        character_face_map = {}
        sd_files = files["sd"]
        precise_metadata = character_metadata(sources, sd_files)
        if not precise_metadata:
            existing_body = GENERATED / "character-map.generated.json"
            existing_face = GENERATED / "character-face-map.generated.json"
            if existing_body.exists():
                character_map = json.loads(existing_body.read_text(encoding="utf-8"))
            if existing_face.exists():
                character_face_map = json.loads(existing_face.read_text(encoding="utf-8"))
            for source in sorted((COMMON / "sd").glob("*.png")):
                shutil.copy2(source, out / "sd" / source.name)
            print("character source metadata unavailable; preserving existing runtime SD mapping")
        body_cache = {}
        body_crops = {}
        face_cache = {}
        layer_metadata = {}
        for key in sorted(character_refs):
            name, expression, costume = (key.split("|", 2) + ["", ""])[:3]
            if name == "ch_effect":
                continue
            candidates = precise_metadata.get(name, [])
            metadata = next((item for item in candidates if any(d.casefold() == costume.casefold() for d in item["dresses"])), None)
            if metadata:
                body_key = (metadata["base"], costume)
                body = body_cache.get(body_key)
                if not body:
                    body_digest = hashlib.sha1(f"{name}|{metadata['base']}|{costume}".encode("utf-8")).hexdigest()[:12]
                    body = f"/common/sd/ch_{body_digest}_body.png"
                    ok, crop = compose_precise_body(metadata, costume, out / "sd" / f"ch_{body_digest}_body.png")
                    if not ok:
                        body = None
                    else:
                        body_cache[body_key] = body
                        body_crops[body_key] = crop
                face_key = (metadata["base"], costume, expression)
                face = face_cache.get(face_key)
                if not face:
                    face_digest = hashlib.sha1(f"{name}|{metadata['base']}|{costume}|{expression}".encode("utf-8")).hexdigest()[:12]
                    face = f"/common/sd/ch_{face_digest}_face.png"
                    if not compose_precise_face(metadata, expression, out / "sd" / f"ch_{face_digest}_face.png", body_crops.get(body_key)):
                        face = None
                    else:
                        face_cache[face_key] = face
                if body:
                    character_map[key] = body
                    if face:
                        character_face_map[key] = face
                    layer_metadata[key] = {
                        "body": body,
                        "face": face or "",
                        "canvas": list(metadata["canvas"]),
                        "crop": list(body_crops.get(body_key) or ()),
                    }
                    continue

            # Keep a deterministic fallback for entries without extracted layer metadata.
            body_candidates = [p for p in sd_files if p.stem.startswith(name) and "_0_" not in p.stem and "fgimage" in {part.casefold() for part in p.parts} and image_size(p)[1] >= 700]
            if not body_candidates:
                continue
            source_file = sorted(body_candidates, key=lambda path: (path.stat().st_size, str(path)), reverse=True)[0]
            digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
            body_name = f"ch_{digest}_body.png"
            body_target = out / "sd" / body_name
            with Image.open(source_file) as source:
                save_character_canvas(source.convert("RGBA"), body_target)
            character_map[key] = f"/common/sd/{body_name}"
        if any(k.startswith("ch_effect") for k in character_refs):
            effect = pick_containing("集中線", files) or (COMMON / "overlay" / "集中線.png")
            if effect:
                convert(effect, out / "overlay" / "集中線.png", "overlay")
                for key in character_refs:
                    if key.startswith("ch_effect"):
                        character_map[key] = "/common/overlay/集中線.png"

        # One representative image for every evNNN group; aliases map to it.
        groups = sorted({m.group(1) for value in visual_refs if (m := re.match(r"ev(\d+)", value, re.I))})
        for group in groups:
            candidates = [p for p in files["ev"] if re.match(rf"(?:ev)?{re.escape(group)}", p.stem, re.I)] or runtime_ev_indexes.get(f"ev{group}".casefold(), [])
            if not candidates:
                raise RuntimeError(f"missing event source: ev{group}")
            target_name = f"ev{group}.png"
            convert(candidates[0], out / "ev" / target_name, "ev")
            for value in visual_refs:
                if re.match(rf"ev{re.escape(group)}", value, re.I):
                    paths["ev"][value] = f"/common/ev/{target_name}"

        # Direct SD commands are standalone Q-style cut-ins. Keep them in their
        # own manifest bucket so the runtime can render them directly.
        (out / "overlay").mkdir(parents=True, exist_ok=True)
        transparent = out / "overlay" / "transparent.png"
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(transparent, "PNG", optimize=True)
        for value in sorted(visual_refs):
            if value in paths["ev"]:
                continue
            if value.startswith("sd"):
                group = re.match(r"sd(\\d+)", value, re.I)
                event_path = f"/common/ev/ev{group.group(1)}.png" if group and (out / "ev" / f"ev{group.group(1)}.png").exists() else ""
                fallback = next((item for item in character_map.values() if isinstance(item, str) and item.endswith("_body.png")), "")
                if not event_path and not fallback:
                    raise RuntimeError(f"missing direct SD fallback: {value}")
                paths["sd"][value] = event_path or fallback
                continue
            src = pick_exact(value, indexes)
            if src:
                target_name = f"{value}.png"
                convert(src, out / "overlay" / target_name, "overlay")
                paths["ev"][value] = f"/common/overlay/{target_name}"
            else:
                paths["ev"][value] = "/common/overlay/transparent.png"

        sd_merge_report = merge_similar_sd_assets(out / "sd", character_map, character_face_map)
        sd_merge_report["bytes"] = sum(path.stat().st_size for path in (out / "sd").glob("*.png"))
        for key, metadata in layer_metadata.items():
            metadata["body"] = character_map.get(key, metadata.get("body", ""))
            metadata["face"] = character_face_map.get(key, "")

        for folder in ("bg", "sd", "ev", "overlay"):
            (out / folder).mkdir(parents=True, exist_ok=True)
        GENERATED.mkdir(parents=True, exist_ok=True)
        event_sizes = {}
        for value in paths["ev"].values():
            if isinstance(value, str) and value.startswith("/common/ev/"):
                target = out / value.lstrip("/")
                if target.exists():
                    event_sizes[target.stem] = list(image_size(target))
        manifest = {"paths": paths, "eventSizes": event_sizes}
        (GENERATED / "resource-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (GENERATED / "character-map.generated.json").write_text(json.dumps(character_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (GENERATED / "character-face-map.generated.json").write_text(json.dumps(character_face_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        runtime_dir = COMMON / "runtime"
        runtime_dir.mkdir(parents=True, exist_ok=True)
        (runtime_dir / "resource-manifest.txt").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        (runtime_dir / "character-map.txt").write_text(json.dumps(character_map, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        (runtime_dir / "character-face-map.txt").write_text(json.dumps(character_face_map, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        (GENERATED / "character-layer-metadata.generated.json").write_text(json.dumps(layer_metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (GENERATED / "sd-merge-report.json").write_text(json.dumps(sd_merge_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        prune_report = prune_runtime_assets(out, manifest, character_map, character_face_map)
        (GENERATED / "resource-prune-report.json").write_text(json.dumps(prune_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (COMMON / "resource-manifest.js").write_text("// Generated by npm run build:assets.\nexport default " + json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (COMMON / "character-map.js").write_text("// Generated by npm run build:assets.\nexport default " + json.dumps(character_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (COMMON / "character-face-map.js").write_text("// Generated by npm run build:assets.\nexport default " + json.dumps(character_face_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        atomic_swap(out / "bg", COMMON / "bg")
        atomic_swap(out / "sd", COMMON / "sd")
        atomic_swap(out / "ev", COMMON / "ev")
        atomic_swap(out / "overlay", COMMON / "overlay")
        print(f"runtime assets built: bg={len(paths['bg'])} ev={len(paths['ev'])} characters={len(character_map)}")
        return 0
    finally:
        shutil.rmtree(temp_parent, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
