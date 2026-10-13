import requests
import sys

# Disable SSL warnings
requests.packages.urllib3.disable_warnings()

url = "https://pentest-ground.com:4280/vulnerabilities/upload/"
session = requests.Session()
session.verify = False

# First, get the page to get cookies
resp = session.get(url)
print(f"Initial GET status: {resp.status_code}")

# Upload a test.txt file
files = {
    'uploaded': ('test.txt', b'This is a harmless test file content', 'text/plain'),
    'Upload': (None, 'Upload'),
    'MAX_FILE_SIZE': (None, '100000')
}

resp = session.post(url, files=files)
print(f"Upload POST status: {resp.status_code}")
print(f"Response length: {len(resp.text)}")

# Check if upload was successful
if "successfully" in resp.text.lower() or "uploaded" in resp.text.lower():
    print("Upload appears successful!")
else:
    print("Upload result unclear, checking response...")
    
# Print relevant parts of response
if "test.txt" in resp.text:
    print("Found test.txt in response")
    
# Save response for analysis
with open("upload_response.html", "w", encoding="utf-8") as f:
    f.write(resp.text)
    
print("Response saved to upload_response.html")