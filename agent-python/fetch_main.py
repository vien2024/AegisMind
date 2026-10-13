import requests
import sys

url = "https://pentest-ground.com:4280/"
headers = {"Cookie": "security=low"}

try:
    resp = requests.get(url, headers=headers, verify=False, timeout=30)
    print(f"Status: {resp.status_code}")
    print(f"Headers: {dict(resp.headers)}")
    print("\n--- Content (first 5000 chars) ---")
    print(resp.text[:5000])
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)