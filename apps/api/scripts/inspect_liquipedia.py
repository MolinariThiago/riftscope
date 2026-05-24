"""Probe the real Liquipedia HTML structure so we can write tight regexes."""
import re
import httpx

r = httpx.get('https://liquipedia.net/counterstrike/api.php', params={
    'action': 'parse',
    'page': 'Liquipedia:Matches',
    'format': 'json',
    'prop': 'text',
    'redirects': '1',
}, headers={'User-Agent': 'RIFTSCOPE/0.3 dev'}, timeout=20.0)
text = r.json()['parse']['text']['*']

# Find a complete match block — they live inside <div class="match-info">
m = re.search(r'<div class="match-info[^"]*"[^>]*>(.*?)</div>\s*</div>\s*</div>', text, re.DOTALL)
if m:
    block = m.group(0)
    print('FIRST MATCH BLOCK:')
    print(block[:3000])
    print()
    print('=' * 60)

    # Extract pieces from block
    teams = re.findall(r'match-info-header-opponent[^"]*"[^>]*>(.*?)</div>', block, re.DOTALL)
    print(f'opponent blocks: {len(teams)}')
    for t in teams[:2]:
        # Try to extract team name
        name_m = re.search(r'<a[^>]*title="([^"]+)"', t) or re.search(r'>([A-Za-z0-9\.\- ]{2,40})<', t)
        print('  text excerpt:', t[:200].replace('\n', ' '))
        if name_m:
            print('    name:', name_m.group(1))

    scores = re.findall(r'match-info-header-scoreholder-score[^"]*"[^>]*>([^<]+)<', block)
    print(f'scores: {scores[:6]}')

    times = re.findall(r'data-timestamp="(\d+)"', block)
    print(f'timestamps: {times[:3]}')
