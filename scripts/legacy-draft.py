#!/usr/bin/env python3
"""Save legacy generator output as a cloud draft chain, never publish it.
Input stdin: {"parts": ["...", "...", "..."]} or {"raw_text": "...\n---\n..."}.
Configuration: THREADS_HARNESS_URL, THREADS_HARNESS_API_KEY, THREADS_ACCOUNT_ID.
A durable local receipt prevents blindly retrying an uncertain draft creation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from urllib.parse import urlsplit


def parse_parts(payload):
    parts = payload.get('parts')
    if parts is None:
        raw = payload.get('raw_text')
        if not isinstance(raw, str):
            raise ValueError('parts or raw_text is required')
        # Reused from the VPS generator: remove labels and split the three-part output.
        raw = re.sub(r'^```[^\n]*\n|\n```\s*$', '', raw.strip())
        parts = []
        for part in re.split(r'\n\s*---\s*\n', raw):
            part = re.sub(r'【\d+投稿目】[^\n]*\n?', '', part)
            part = re.sub(r'^#+\s+.*$', '', part, flags=re.M)
            part = re.sub(r'^(フック|本文展開|結論|CTA|種明かし)[：:]\s*$', '', part, flags=re.M)
            part = re.sub(r'\*\*([^*]+)\*\*', r'\1', part)
            parts.append(re.sub(r'\n{3,}', '\n\n', part).strip())
    if not isinstance(parts, list) or not 2 <= len(parts) <= 10 or any(not isinstance(p, str) or not p.strip() or len(p) > 500 for p in parts):
        raise ValueError('Use 2–10 nonempty parts, each at most 500 characters; overlength content is not truncated')
    return parts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt', required=True, type=Path, help='One private receipt file per generated chain; preserve it across runs')
    args = parser.parse_args()
    parts = parse_parts(json.load(sys.stdin))
    base = os.environ['THREADS_HARNESS_URL'].rstrip('/')
    url = urlsplit(base)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise ValueError('THREADS_HARNESS_URL must be an HTTPS origin')
    payload = json.dumps({'accountId': os.environ['THREADS_ACCOUNT_ID'], 'parts': parts}, ensure_ascii=False).encode()
    digest = hashlib.sha256(base.encode() + b'\0' + payload).hexdigest()
    if args.receipt.exists():
        old = json.loads(args.receipt.read_text())
        if old.get('sha256') != digest:
            raise ValueError('Receipt belongs to different content or destination')
        if old.get('status') == 'saved':
            print(json.dumps({'status': 'already_saved', 'chainId': old['chainId']})); return
        raise ValueError('Earlier result is uncertain. Check the cloud drafts before any manual retry')
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(args.receipt, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'sha256': digest, 'status': 'pending'}, f); f.flush(); os.fsync(f.fileno())
    request = Request(base + '/api/chains', data=payload, headers={'Authorization': 'Bearer ' + os.environ['THREADS_HARNESS_API_KEY'], 'Content-Type': 'application/json', 'User-Agent': 'Threads-Harness-Legacy-Adapter/1.0'})
    # No transport retries: receipt remains pending on any ambiguous result.
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    data = result['data']
    if not result.get('success') or not isinstance(data.get('chainId'), str):
        raise ValueError('Unconfirmed cloud response')
    with args.receipt.open('w') as f:
        json.dump({'sha256': digest, 'status': 'saved', 'chainId': data['chainId']}, f); f.flush(); os.fsync(f.fileno())
    print(json.dumps({'status': 'saved', 'chainId': data['chainId']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never log HTTP response bodies, token-bearing requests, or source contents.
        print('Draft transfer stopped: ' + type(error).__name__ + '. Check input, connection and receipt before retrying.', file=sys.stderr)
        sys.exit(1)
