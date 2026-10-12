import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def as_bool(value: str | None) -> bool:
    return str(value).lower() in {"1", "true", "yes", "on"}


class Config:
    PORT = int(os.getenv("PORT", "5000"))
    DEBUG = as_bool(os.getenv("FLASK_DEBUG", "false"))
    JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
    JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "24"))
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5500")
    FRONTEND_URLS = [
        origin.strip().rstrip("/")
        for origin in os.getenv("FRONTEND_URLS", FRONTEND_URL).split(",")
        if origin.strip()
    ]

    DB_CONFIG = {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
        "database": os.getenv("DB_NAME", "task_manager"),
    }

    if as_bool(os.getenv("DB_SSL_ENABLED", "false")):
        ca_path = os.getenv("DB_SSL_CA", "")
        if ca_path:
            DB_CONFIG["ssl_ca"] = str(Path(ca_path))
        DB_CONFIG["ssl_verify_cert"] = True
