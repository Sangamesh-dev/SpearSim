"""
Shared utility functions used across route modules.
Centralises helpers that were previously duplicated in every route file.
"""
import uuid
from fastapi import Request


import ipaddress

PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
]

def _is_private(ip: str) -> bool:
    try:
        return any(ipaddress.ip_address(ip) in net for net in PRIVATE_NETWORKS)
    except ValueError:
        return False

def get_client_ip(request: Request) -> str:
    """Extract client IP securely, verifying trusted proxy before using X-Forwarded-For."""
    direct_ip = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded and _is_private(direct_ip):
        return forwarded.split(",")[0].strip()
    return direct_ip


def generate_alias() -> str:
    """
    Generate a pseudonymised employee alias, e.g. 'Employee_3F9A'.
    Used during CSV upload to replace real names before storage.
    """
    suffix = uuid.uuid4().hex[:4].upper()
    return f"Employee_{suffix}"
