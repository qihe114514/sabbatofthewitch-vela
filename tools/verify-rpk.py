#!/usr/bin/env python3
import hashlib
import sys
import zipfile
from pathlib import Path

LIMIT = 20_000_000
path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'dist'
if path.is_dir():
    candidates = sorted(path.glob('*.rpk'), key=lambda item: item.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit('dist 中没有 .rpk')
    path = candidates[0]
with zipfile.ZipFile(path) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f'CRC 校验失败: {bad}')
    names = archive.namelist()
    required = {'manifest.json', 'manifest-watch.json', 'META-INF/CERT'}
    missing = sorted(required - set(names))
    if missing:
        raise SystemExit('RPK 缺少必要文件: ' + ', '.join(missing))
    uncompressed = sum(item.file_size for item in archive.infolist())
    print(f'RPK 完整性通过: {path.name}')
    print(f'大小: {path.stat().st_size} bytes; 条目: {len(names)}; 解压后: {uncompressed} bytes')
    print('SHA256:', hashlib.sha256(path.read_bytes()).hexdigest())
    if path.stat().st_size > LIMIT:
        raise SystemExit(f'RPK 超过 20 MB: {path.stat().st_size}')
