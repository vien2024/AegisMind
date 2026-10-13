import requests
import sys
from urllib.parse import urljoin

requests.packages.urllib3.disable_warnings()

BASE_URL = "https://pentest-ground.com:4280/"

# Examine the content of found files
paths_to_examine = [
    "phpinfo.php",
    "setup.php",
    "security.php",
    "about.php",
    "instructions.php",
    "robots.txt",
    "dvwa/config/config.inc.php",
    "dvwa/config/config.inc.php.bak",
    ".git/config",
    ".git/HEAD",
    ".git/index",
    "composer.json",
    "package.json",
    ".env",
    ".env.example",
]

def examine_path(path):
    url = urljoin(BASE_URL, path)
    try:
        resp = requests.get(url, verify=False, timeout=15, allow_redirects=False)
        print(f"\n{'='*80}")
        print(f"=== {path} (HTTP {resp.status_code}) ===")
        print(f"Content-Type: {resp.headers.get('Content-Type')}")
        print(f"Content-Length: {len(resp.content)}")
        print(f"{'='*80}")
        # Print first 3000 chars
        print(resp.text[:3000])
        if len(resp.text) > 3000:
            print(f"\n... (truncated, total {len(resp.text)} chars)")
    except Exception as e:
        print(f"[ERROR] {path}: {e}")

def main():
    for path in paths_to_examine:
        examine_path(path)

if __name__ == "__main__":
    main()