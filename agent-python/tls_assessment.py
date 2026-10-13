#!/usr/bin/env python3
"""TLS and Security Configuration Assessment for pentest-ground.com:4280"""

import ssl
import socket
import json
import sys
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

TARGET_HOST = "pentest-ground.com"
TARGET_PORT = 4280
TARGET_URL = f"https://{TARGET_HOST}:{TARGET_PORT}/"

def get_tls_info():
    """Get TLS certificate and connection details"""
    print(f"[*] Connecting to {TARGET_HOST}:{TARGET_PORT} for TLS assessment...")
    
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    
    results = {
        "host": TARGET_HOST,
        "port": TARGET_PORT,
        "certificate": {},
        "protocol": "",
        "cipher": "",
        "supported_protocols": {},
        "errors": []
    }
    
    try:
        with socket.create_connection((TARGET_HOST, TARGET_PORT), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=TARGET_HOST) as ssock:
                # Get negotiated protocol and cipher
                results["protocol"] = ssock.version()
                results["cipher"] = ssock.cipher()
                
                # Get certificate
                cert = ssock.getpeercert()
                if cert:
                    results["certificate"] = {
                        "subject": dict(x[0] for x in cert.get('subject', [])),
                        "issuer": dict(x[0] for x in cert.get('issuer', [])),
                        "version": cert.get('version'),
                        "serial_number": cert.get('serialNumber'),
                        "not_before": cert.get('notBefore'),
                        "not_after": cert.get('notAfter'),
                        "subject_alt_names": cert.get('subjectAltName', []),
                        "ocsp": cert.get('OCSP', []),
                        "ca_issuers": cert.get('caIssuers', []),
                        "crl_distribution_points": cert.get('crlDistributionPoints', [])
                    }
                
                # Get certificate binary for fingerprint
                cert_bin = ssock.getpeercert(binary_form=True)
                if cert_bin:
                    import hashlib
                    results["certificate"]["sha256_fingerprint"] = hashlib.sha256(cert_bin).hexdigest()
                    results["certificate"]["sha1_fingerprint"] = hashlib.sha1(cert_bin).hexdigest()
                    
    except Exception as e:
        results["errors"].append(f"TLS connection error: {str(e)}")
    
    return results

def check_protocol_support():
    """Check which TLS/SSL protocols are supported"""
    protocols = {
        "SSLv2": ssl.PROTOCOL_SSLv2 if hasattr(ssl, 'PROTOCOL_SSLv2') else None,
        "SSLv3": ssl.PROTOCOL_SSLv3 if hasattr(ssl, 'PROTOCOL_SSLv3') else None,
        "TLSv1": ssl.PROTOCOL_TLSv1 if hasattr(ssl, 'PROTOCOL_TLSv1') else None,
        "TLSv1.1": ssl.PROTOCOL_TLSv1_1 if hasattr(ssl, 'PROTOCOL_TLSv1_1') else None,
        "TLSv1.2": ssl.PROTOCOL_TLSv1_2 if hasattr(ssl, 'PROTOCOL_TLSv1_2') else None,
        "TLSv1.3": ssl.PROTOCOL_TLS if hasattr(ssl, 'PROTOCOL_TLS') else None,
    }
    
    results = {}
    for name, proto in protocols.items():
        if proto is None:
            results[name] = "not_available_in_python"
            continue
            
        try:
            context = ssl.SSLContext(proto)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            with socket.create_connection((TARGET_HOST, TARGET_PORT), timeout=5) as sock:
                with context.wrap_socket(sock, server_hostname=TARGET_HOST) as ssock:
                    results[name] = ssock.version()
        except Exception as e:
            results[name] = f"failed: {str(e)}"
    
    return results

def get_security_headers():
    """Fetch security headers from the target"""
    print(f"[*] Fetching security headers from {TARGET_URL}...")
    
    headers_to_check = [
        "Strict-Transport-Security",
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "X-XSS-Protection",
        "Referrer-Policy",
        "Permissions-Policy",
        "Cross-Origin-Opener-Policy",
        "Cross-Origin-Resource-Policy",
        "Cross-Origin-Embedder-Policy",
        "Server",
        "X-Powered-By"
    ]
    
    results = {
        "url": TARGET_URL,
        "headers": {},
        "missing_headers": [],
        "errors": []
    }
    
    try:
        req = Request(TARGET_URL, headers={'User-Agent': 'AegisMind-TLS-Assessment/1.0'})
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        
        with urlopen(req, context=context, timeout=10) as response:
            response_headers = dict(response.headers)
            
            for header in headers_to_check:
                if header in response_headers:
                    results["headers"][header] = response_headers[header]
                else:
                    results["missing_headers"].append(header)
                    
    except HTTPError as e:
        # Even on HTTP error, we can get headers
        response_headers = dict(e.headers)
        for header in headers_to_check:
            if header in response_headers:
                results["headers"][header] = response_headers[header]
            else:
                results["missing_headers"].append(header)
        results["errors"].append(f"HTTP {e.code}: {e.reason}")
    except URLError as e:
        results["errors"].append(f"URL Error: {str(e)}")
    except Exception as e:
        results["errors"].append(f"Unexpected error: {str(e)}")
    
    return results

def analyze_certificate(cert_info):
    """Analyze certificate for issues"""
    findings = []
    
    if not cert_info:
        findings.append({"severity": "high", "issue": "No certificate information available"})
        return findings
    
    # Check expiry
    if "not_after" in cert_info:
        try:
            expiry = datetime.strptime(cert_info["not_after"], "%b %d %H:%M:%S %Y %Z")
            days_until_expiry = (expiry - datetime.utcnow()).days
            if days_until_expiry < 0:
                findings.append({"severity": "critical", "issue": f"Certificate expired {abs(days_until_expiry)} days ago"})
            elif days_until_expiry < 30:
                findings.append({"severity": "high", "issue": f"Certificate expires in {days_until_expiry} days"})
            elif days_until_expiry < 90:
                findings.append({"severity": "medium", "issue": f"Certificate expires in {days_until_expiry} days"})
        except Exception:
            pass
    
    # Check SAN
    if "subject_alt_names" in cert_info:
        san_count = len(cert_info["subject_alt_names"])
        if san_count == 0:
            findings.append({"severity": "medium", "issue": "No Subject Alternative Names in certificate"})
    
    # Check key usage / extensions would require more parsing
    
    return findings

def main():
    print("=" * 60)
    print("TLS and Security Configuration Assessment")
    print(f"Target: {TARGET_HOST}:{TARGET_PORT}")
    print("=" * 60)
    
    # Get TLS info
    tls_results = get_tls_info()
    
    # Check protocol support
    print("[*] Checking TLS protocol support...")
    tls_results["supported_protocols"] = check_protocol_support()
    
    # Get security headers
    header_results = get_security_headers()
    
    # Analyze certificate
    cert_findings = analyze_certificate(tls_results.get("certificate", {}))
    
    # Output results
    print("\n" + "=" * 60)
    print("TLS CONNECTION RESULTS")
    print("=" * 60)
    print(f"Negotiated Protocol: {tls_results.get('protocol', 'N/A')}")
    print(f"Negotiated Cipher: {tls_results.get('cipher', 'N/A')}")
    
    print("\n--- Certificate Details ---")
    cert = tls_results.get("certificate", {})
    if cert:
        print(f"Subject: {cert.get('subject', {})}")
        print(f"Issuer: {cert.get('issuer', {})}")
        print(f"Valid From: {cert.get('not_before', 'N/A')}")
        print(f"Valid Until: {cert.get('not_after', 'N/A')}")
        print(f"SANs: {cert.get('subject_alt_names', [])}")
        print(f"SHA256 Fingerprint: {cert.get('sha256_fingerprint', 'N/A')}")
        print(f"SHA1 Fingerprint: {cert.get('sha1_fingerprint', 'N/A')}")
    
    print("\n--- Protocol Support ---")
    for proto, result in tls_results.get("supported_protocols", {}).items():
        print(f"  {proto}: {result}")
    
    print("\n" + "=" * 60)
    print("SECURITY HEADERS")
    print("=" * 60)
    for header, value in header_results.get("headers", {}).items():
        print(f"  {header}: {value}")
    
    if header_results.get("missing_headers"):
        print("\n--- Missing Security Headers ---")
        for header in header_results["missing_headers"]:
            print(f"  {header}: NOT PRESENT")
    
    if header_results.get("errors"):
        print("\n--- Header Fetch Errors ---")
        for err in header_results["errors"]:
            print(f"  {err}")
    
    print("\n" + "=" * 60)
    print("CERTIFICATE FINDINGS")
    print("=" * 60)
    for finding in cert_findings:
        print(f"  [{finding['severity'].upper()}] {finding['issue']}")
    
    if not cert_findings:
        print("  No issues found")
    
    # Save full results to JSON
    output = {
        "tls": tls_results,
        "headers": header_results,
        "certificate_findings": cert_findings
    }
    
    with open("tls_assessment_results.json", "w") as f:
        json.dump(output, f, indent=2, default=str)
    
    print("\n[*] Results saved to tls_assessment_results.json")
    return output

if __name__ == "__main__":
    main()