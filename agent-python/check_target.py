import requests
import sys

# Disable SSL warnings
requests.packages.urllib3.disable_warnings()

url = "https://pentest-ground.com:4280/"

try:
    resp = requests.get(url, verify=False, timeout=30)
    print(f"Status: {resp.status_code}")
    print(f"Content-Type: {resp.headers.get('Content-Type')}")
    print(f"Server: {resp.headers.get('Server')}")
    print(f"Content-Length: {len(resp.content)}")
    # Print first 5000 chars of response
    print(f"Body preview: {resp.text[:5000]}")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)