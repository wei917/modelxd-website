import urllib.request
import json

URL = "https://modelxd.com/api/cron/sync-models"
CRON_SECRET = "your_cron_secret_here"  # replace this

req = urllib.request.Request(
    URL,
    method='GET',
    headers={'Authorization': f'Bearer {CRON_SECRET}'}
)

with urllib.request.urlopen(req) as res:
    body = json.loads(res.read().decode())
    print(body)
