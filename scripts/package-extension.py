from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
source = root / 'browser-extension'
manifest = json.loads((source / 'manifest.json').read_text())
version = manifest['version']
files = ['newtab.html', 'app.js', 'style.css', 'icon.svg', 'bridge.js', 'storage.js',
         'github-client.js', 'api.js', 'local-ai.js', 'privacy.html']
files += [f'icons/{size}.png' for size in (16, 32, 48, 128)]
output = root / 'dist'
output.mkdir(exist_ok=True)
for store in (False, True):
    name = f'开源雷达-{"商店上传" if store else "独立本地安装"}-{version}.zip'
    package_manifest = dict(manifest)
    if store:
        package_manifest.pop('key', None)
    with ZipFile(output / name, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(package_manifest, ensure_ascii=False, indent=2) + '\n')
        for file in files:
            archive.write(source / file, file)
    with ZipFile(output / name) as archive:
        assert archive.testzip() is None
        assert 'manifest.json' in archive.namelist()
        assert len(archive.namelist()) == len(files) + 1
    print(output / name)
