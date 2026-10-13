import requests
import sys

base = "https://pentest-ground.com:4280/"
headers = {"Cookie": "security=low"}

pages = [
    "login.php",
    "security.php",
    "phpinfo.php",
    "about.php",
    "instructions.php",
    "setup.php"
]

for page in pages:
    url = base + page
    try:
        resp = requests.get(url, headers=headers, verify=False, timeout=30)
        print(f"\n{'='*60}")
        print(f"=== {page} (Status: {resp.status_code}) ===")
        print(f"{'='*60}")
        print(resp.text[:3000])
    except Exception as e:
        print(f"Error fetching {page}: {e}")