"""Read-only public documentation collection; no product service calls."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import urllib.request
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'sources' / 'official'
DEST.mkdir(parents=True, exist_ok=True)
# Reuse the already configured macOS system proxy; do not change network settings.
opener = urllib.request.build_opener(urllib.request.ProxyHandler({
    'https': 'http://127.0.0.1:7892', 'http': 'http://127.0.0.1:7892',
}))


def fetch(url):
    filename = 'llms.txt' if url.endswith('/llms.txt') else url.rsplit('/', 1)[-1]
    if urlparse(url).hostname == 'cursor.com':
        filename = 'cursor-help-' + filename.removesuffix('.md') + '.md'
    target = DEST / filename
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Negus-product-research'})
        with opener.open(request, timeout=25) as response:
            body = response.read()
            target.write_bytes(body)
            return {'url': url, 'finalUrl': response.geturl(), 'status': response.status,
                    'file': str(target.relative_to(ROOT)), 'sha256': sha256(body).hexdigest(),
                    'bytes': len(body), 'collectedAt': datetime.now(timezone.utc).isoformat()}
    except Exception as error:
        return {'url': url, 'error': str(error), 'collectedAt': datetime.now(timezone.utc).isoformat()}


index = fetch('https://docs.x.ai/llms.txt')
if 'error' in index:
    raise SystemExit(index['error'])
urls = sorted(set(re.findall(r'https://docs\.x\.ai/grok-bot/[a-z0-9-]+\.md', (DEST / 'llms.txt').read_text())))
with ThreadPoolExecutor(max_workers=4) as executor:
    entries = [index, *executor.map(fetch, urls)]
# Follow documented Grok Bot links omitted from the index, if any.
seen = set(urls)
for _ in range(3):
    linked = set()
    for entry in entries:
        if 'file' not in entry or entry['url'].endswith('/llms.txt'):
            continue
        body = (ROOT / entry['file']).read_text()
        links = re.findall(r'\]\(([^)]+)\)', body) + re.findall(r'href="([^"?#]+)', body)
        for link in links:
            resolved = urljoin(entry['url'], link).split('#', 1)[0]
            parsed = urlparse(resolved)
            if parsed.hostname == 'docs.x.ai' and re.fullmatch(r'/grok-bot/[a-z0-9-]+(?:\.md)?', parsed.path):
                linked.add(resolved if resolved.endswith('.md') else resolved + '.md')
            elif parsed.hostname == 'cursor.com' and re.fullmatch(r'/help/grok-bot/[a-z0-9-]+', parsed.path):
                linked.add(resolved)
    missing = sorted(linked - seen)
    if not missing:
        break
    seen.update(missing)
    with ThreadPoolExecutor(max_workers=4) as executor:
        entries.extend(executor.map(fetch, missing))
(ROOT / 'official-manifest.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
for entry in entries:
    print(json.dumps({k: entry[k] for k in ['url', 'status', 'bytes', 'error'] if k in entry}))
