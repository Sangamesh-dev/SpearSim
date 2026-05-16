"""
PhishSim — FastAPI Application Entry Point
Enterprise-grade phishing simulation platform with GDPR compliance.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import time

from app.config import get_settings
from app.routes import campaigns, employees, tracking, gdpr, organizations, profile, invite

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.limiter import limiter

settings = get_settings()

# ============================================================
# App initialization
# ============================================================
app = FastAPI(
    title="PhishSim API",
    description=(
        "GDPR-compliant phishing simulation platform for security awareness training. "
        "All employee data is pseudonymised. No real credentials are captured."
    ),
    version="1.0.0",
    docs_url="/api/docs" if settings.environment == "development" else None,
    redoc_url="/api/redoc" if settings.environment == "development" else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ============================================================
# CORS
# ============================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Request timing middleware
# ============================================================
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(round(process_time * 1000, 2))
    return response

# ============================================================
# Security headers middleware
# ============================================================
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';"
    )
    return response

# ============================================================
# Global exception handler
# ============================================================
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    detail = str(exc) if settings.environment == "development" else "Internal server error"
    return JSONResponse(status_code=500, content={"success": False, "error": detail})

# ============================================================
# Routers
# ============================================================
app.include_router(organizations.router)
app.include_router(campaigns.router)
app.include_router(employees.router)
app.include_router(tracking.router)
app.include_router(gdpr.router)
app.include_router(profile.router)
app.include_router(invite.router)

# ============================================================
# Health check
# ============================================================
@app.get("/health", tags=["system"])
async def health_check():
    return {
        "status": "healthy",
        "service": "PhishSim API",
        "version": "1.0.0",
        "environment": settings.environment,
    }

@app.get("/", tags=["system"])
async def root():
    return {
        "service": "PhishSim API",
        "docs": "/api/docs",
        "health": "/health",
    }
