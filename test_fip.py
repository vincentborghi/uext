# Examples:
#   python test_fip.py --verbose
#   python test_fip.py --help

import argparse
import json
import time
import urllib.request

def test_pull(args):
    url = "https://api.radiofrance.fr/livemeta/pull/7"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    
    now_ts = int(time.time())
    steps = data.get("steps", {})
    levels = data.get("levels", [])
    print(f"Total steps: {len(steps)}, Levels: {levels}")
    
    # Sort steps by start desc
    songs = [v for v in steps.values() if v.get("embedType") == "song" or v.get("title")]
    songs.sort(key=lambda s: s.get("start", 0), reverse=True)
    
    for s in songs:
        in_range = s.get("start", 0) <= now_ts <= s.get("end", 0)
        print(f"Title: {s.get('title')} | Artist: {s.get('authors') or s.get('performers')} | InRange: {in_range}")

def main():
    parser = argparse.ArgumentParser()
    args = parser.parse_args()
    test_pull(args)

if __name__ == "__main__":
    main()
