import requests
import sys
from urllib.parse import urljoin

requests.packages.urllib3.disable_warnings()

BASE_URL = "https://pentest-ground.com:4280/"

# Common sensitive files and directories to check
SENSITIVE_PATHS = [
    # Git related
    ".git/",
    ".git/config",
    ".git/HEAD",
    ".git/index",
    ".git/logs/HEAD",
    ".gitignore",
    ".gitattributes",
    
    # SVN
    ".svn/",
    ".svn/entries",
    ".svn/wc.db",
    
    # Mercurial
    ".hg/",
    ".hg/store",
    
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
    "config.php.save",
    "configuration.php",
    "settings.php",
    "settings.php.bak",
    "wp-config.php",
    "wp-config.php.bak",
    "wp-config.php~",
    "web.config",
    "web.config.bak",
    ".env",
    ".env.bak",
    ".env.example",
    ".env.production",
    ".env.development",
    ".env.local",
    "config.json",
    "config.yaml",
    "config.yml",
    "parameters.yml",
    "parameters.yml.dist",
    
    # Database files
    "database.db",
    "database.sqlite",
    "database.sqlite3",
    "data.db",
    "data.sqlite",
    
    # Source code / IDE
    ".DS_Store",
    "Thumbs.db",
    ".project",
    ".buildpath",
    ".settings/",
    "*.swp",
    "*.swo",
    "*~",
    "*.bak",
    "*.orig",
    "*.old",
    
    # Log files
    "error.log",
    "access.log",
    "debug.log",
    "php_errors.log",
    "application.log",
    "laravel.log",
    "symfony.log",
    
    # API Documentation
    "swagger.json",
    "swagger.yaml",
    "swagger.yml",
    "openapi.json",
    "openapi.yaml",
    "openapi.yml",
    "api-docs/",
    "api/docs/",
    "docs/",
    "swagger/",
    "swagger-ui/",
    "redoc/",
    
    # Server info
    "phpinfo.php",
    "info.php",
    "test.php",
    "server-status",
    "server-info",
    "status",
    "health",
    "healthz",
    
    # Common directories
    "admin/",
    "administrator/",
    "backend/",
    "manager/",
    "console/",
    "cpanel/",
    "phpmyadmin/",
    "pma/",
    "mysql/",
    "sql/",
    "db/",
    "database/",
    "webdav/",
    "dav/",
    
    # DVWA specific
    "setup.php",
    "instructions.php",
    "about.php",
    "security.php",
    "dvwa/",
    "dvwa/config/",
    "dvwa/config/config.inc.php",
    "dvwa/config/config.inc.php.bak",
    "dvwa/config/config.inc.php~",
    "dvwa/includes/",
    "dvwa/.git/",
    "dvwa/.git/config",
    
    # Robots and sitemap
    "robots.txt",
    "sitemap.xml",
    "sitemap.xml.gz",
    "sitemap_index.xml",
    
    # Other sensitive
    ".htaccess",
    ".htpasswd",
    "composer.json",
    "composer.lock",
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "Gemfile",
    "Gemfile.lock",
    "requirements.txt",
    "Pipfile",
    "Pipfile.lock",
    "go.mod",
    "go.sum",
    "Cargo.toml",
    "Cargo.lock",
]

def check_path(path):
    url = urljoin(BASE_URL, path)
    try:
        resp = requests.get(url, verify=False, timeout=15, allow_redirects=False)
        return {
            "path": path,
            "url": url,
            "status": resp.status_code,
            "content_type": resp.headers.get("Content-Type", ""),
            "content_length": len(resp.content),
            "server": resp.headers.get("Server", ""),
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
    for path in SENSITIVE_PATHS:
        result = check_path(path)
        results.append(result)
        
        if result.get("error"):
            print(f"[ERROR] {path}: {result['error']}")
        elif result["status"] in [200, 301, 302]:
            print(f"[FOUND] {path} -> {result['status']} ({result['content_length']} bytes, {result['content_type']})")
        elif result["status"] in [403, 401]:
            print(f"[FORBIDDEN] {path} -> {result['status']} (access denied but exists)")
        elif result["status"] == 500:
            print(f"[ERROR 500] {path} -> {result['status']} (server error)")
    
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