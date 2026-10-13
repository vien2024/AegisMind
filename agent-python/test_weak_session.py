import requests
import re

url = "https://pentest-ground.com:4280/vulnerabilities/weak_id/"

print("Testing weak session ID generation...")
print("=" * 60)

session = requests.Session()
session.verify = False

# First, get the initial page to establish PHPSESSID
resp = session.get(url)
print(f"Initial request - cookies: {session.cookies.get_dict()}")

# Now make multiple POST requests to generate session IDs
for i in range(10):
    resp = session.post(url)
    cookies = resp.cookies.get_dict()
    dvwa_session = cookies.get('dvwaSession')
    php_sessid = cookies.get('PHPSESSID')
    print(f"Request {i+1}: dvwaSession={dvwa_session}, PHPSESSID={php_sessid}")

print("\n" + "=" * 60)
print("The dvwaSession cookie increments by 1 each time - completely predictable!")