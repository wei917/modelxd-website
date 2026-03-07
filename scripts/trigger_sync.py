#!/usr/bin/env python3
# scripts/trigger_sync.py
# Manually trigger the sync-models cron job
#
# Usage:
#   export CRON_SECRET=your_secret
#   python scripts/trigger_sync.py
#
# Or with custom URL:
#   python scripts/trigger_sync.py --url https://modelxd.com

import urllib.request
import urllib.error
import json
import os
import argparse

def trigger_sync(base_url: str, cron_secret: str):
    url = f"{base_url}/api/cron/sync-models"
    print(f"Triggering sync: {url}")

    req = urllib.request.Request(
        url,
        method='GET',
        headers={
            'Authorization': f'Bearer {cron_secret}',
        }
    )

    try:
        with urllib.request.urlopen(req) as res:
            body = json.loads(res.read().decode())
            print(f"✅ Success!")
            print(f"   Synced:   {body.get('synced')} models")
            print(f"   Duration: {body.get('duration')}")
            breakdown = body.get('breakdown', {})
            print(f"   Language: {breakdown.get('language', 0)}")
            print(f"   Image:    {breakdown.get('image', 0)}")
            print(f"   Video:    {breakdown.get('video', 0)}")
            if body.get('missing'):
                print(f"   Missing:  {body.get('missing')}")

    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"❌ HTTP {e.code}: {body}")
    except urllib.error.URLError as e:
        print(f"❌ Request failed: {e.reason}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Trigger ModelXD sync-models cron job')
    parser.add_argument('--url', default='https://modelxd.com', help='Base URL of your deployment')
    args = parser.parse_args()

    cron_secret = os.environ.get('CRON_SECRET')
    if not cron_secret:
        print("❌ CRON_SECRET env var not set")
        print("   Run: export CRON_SECRET=your_secret")
        exit(1)

    trigger_sync(args.url, cron_secret)
