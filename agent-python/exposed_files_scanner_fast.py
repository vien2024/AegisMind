import requests
import sys
import threading
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed

requests.packages.urllib3.disable_warnings()

BASE_URL = "https://pentest-ground.com:4280/"

# Most critical sensitive paths to check first
SENSITIVE_PATHS = [
    # Git related
    ".git/",
    ".git/config",
    ".git/HEAD",
    ".gitignore",
    
    # SVN
    ".svn/",
    ".svn/entries",
    
    # Mercurial
    ".hg/",
    
    # Backup files
    "backup/",
    "backups/",
    "backup.zip",
    "backup.tar.gz",
    "backup.sql",
    "db_backup.sql",
    "database.sql",
    "dump.sql",
    "site_backup.zip",
    "www.zip",
    "www.tar.gz",
    
    # Configuration files
    "config.php",
    "config.inc.php",
    "config.php.bak",
    "config.php~",
    "configuration.php",
    "settings.php",
    "wp-config.php",
    "wp-config.php.bak",
    "web.config",
    ".env",
    ".env.bak",
    ".env.example",
    "config.json",
    "config.yaml",
    "config.yml",
    "parameters.yml",
    
    # Database files
    "database.db",
    "database.sqlite",
    "data.db",
    
    # Source code / IDE
    ".DS_Store",
    "Thumbs.db",
    
    # Log files
    "error.log",
    "access.log",
    "debug.log",
    "php_errors.log",
    
    # API Documentation
    "swagger.json",
    "swagger.yaml",
    "openapi.json",
    "openapi.yaml",
    "api-docs/",
    "swagger/",
    "swagger-ui/",
    "redoc/",
    
    # Server info
    "phpinfo.php",
    "info.php",
    "test.php",
    "server-status",
    "health",
    
    # Common directories
    "admin/",
    "administrator/",
    "backend/",
    "phpmyadmin/",
    "pma/",
    
    # DVWA specific
    "setup.php",
    "instructions.php",
    "about.php",
    "security.php",
    "dvwa/config/config.inc.php",
    "dvwa/config/config.inc.php.bak",
    "dvwa/.git/config",
    
    # Robots and sitemap
    "robots.txt",
    "sitemap.xml",
    
    # Other sensitive
    ".htaccess",
    ".htpasswd",
    "composer.json",
    "composer.lock",
    "package.json",
    "requirements.txt",
]

def check_path(path):
    url = urljoin(BASE_URL, path)
    try:
        resp = requests.get(url, verify=False, timeout=10, allow_redirects=False)
        return {
            "path": path,
            "url": url,
            "status": resp.status_code,
            "content_type": resp.headers.get("Content-Type", ""),
            "content_length": len(resp.content),
            "server": resp.headers.get("Server", ""),
            "headers": dict(resp.headers),
            "interesting": resp.status_code in [200, 301, 302, 403, 401, 500] and len(resp.content) > 0
        }
    except Exception as e:
        return {
            "path": path,
            "url": url,
            "error": str(e),
            "status": None
        }

def main():
    print(f"Scanning {BASE_URL} for exposed files and sensitive information...")
    print("=" * 80)
    
    results = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_path = {executor.submit(check_path, path): path for path in SENSITIVE_PATHS}
        for future in as_completed(future_to_path):
            result = future.result()
            results.append(result)
            
            if result.get("error"):
                print(f"[ERROR] {result['path']}: {result['error']}")
            elif result["status"] in [200, 301, 302]:
                print(f"[FOUND] {result['path']} -> {result['status']} ({result['content_length']} bytes, {result['content_type']})")
            elif result["status"] in [403, 401]:
                print(f"[FORBIDDEN] {result['path']} -> {result['status']} (access denied but exists)")
            elif result["status"] == 500:
                print(f"[ERROR 500] {result['path']} -> {result['status']} (server error)")
    
    # Save detailed results
    import json
    with open("exposed_files_results.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print("\n" + "=" * 80)
    print("Summary of interesting findings:")
    print("=" * 80)
    
    interesting = [r for r in results if r.get("interesting")]
    for r in interesting:
        print(f"  {r['path']}: HTTP {r['status']} - {r['content_length']} bytes - {r['content_type']}")

if __name__ == "__main__":
    main()