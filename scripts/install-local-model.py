#!/usr/bin/env python3
"""Install pinned official local CPU inference assets. No credentials or cloud inference."""
import hashlib
import json
import os
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(os.environ.get('GITHUB_TOP_AI_HOME', str(Path.home() / '.local/share/github-top/local-ai')))
ASSETS = [
    ('llama-b11207-bin-ubuntu-x64.tar.gz', 'https://github.com/ggml-org/llama.cpp/releases/download/b11207/llama-b11207-bin-ubuntu-x64.tar.gz', '42ef38a895948612bc4741bb80142e12bb33956dd54e1a3bb4eaba989711ba1d', 17402948),
    ('Qwen3-1.7B-Q8_0.gguf', 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf', '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a', 1834426016),
]

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
for name, url, checksum, size in ASSETS:
    target = ROOT / name
    if target.exists() and target.stat().st_size == size and sha(target) == checksum:
        print(f'已校验，复用 {name}', flush=True)
        continue
    temporary = ROOT / (name + '.download')
    request = urllib.request.Request(url, headers={'User-Agent': 'github-top-local-ai/1.0'})
    print(f'下载官方文件 {name}，{size / 1024 ** 2:.1f} MiB', flush=True)
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as handle:
        total, reported = 0, 0
        while True:
            chunk = response.read(4 * 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > size:
                raise RuntimeError('下载大小超过官方记录')
            handle.write(chunk)
            if total - reported >= 100 * 1024 * 1024:
                reported = total
                print(f'  {total / size:.0%}', flush=True)
    if temporary.stat().st_size != size or sha(temporary) != checksum:
        raise RuntimeError(f'校验失败：{name}；不会使用该文件')
    temporary.replace(target)
    print(f'SHA256 已验证：{name}', flush=True)

runtime = ROOT / 'runtime'
runtime.mkdir(exist_ok=True, mode=0o700)
with tarfile.open(ROOT / ASSETS[0][0]) as archive:
    # Python's data filter rejects escaping paths and unsafe links.
    archive.extractall(runtime, filter='data')
servers = list(runtime.rglob('llama-server'))
if len(servers) != 1:
    raise RuntimeError('官方压缩包未包含唯一的 llama-server')
manifest = {
    'model': 'Qwen3-1.7B-Q8_0',
    'modelFile': str(ROOT / ASSETS[1][0]),
    'binary': str(servers[0]),
    'engine': 'llama.cpp b11207',
    'modelRevision': '90862c4b9d2787eaed51d12237eafdfe7c5f6077',
    'assets': [{'name': name, 'url': url, 'sha256': checksum, 'bytes': size} for name, url, checksum, size in ASSETS],
}
manifest_path = ROOT / 'manifest.json'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
manifest_path.chmod(0o600)
print(f'安装完成：{ROOT}', flush=True)
