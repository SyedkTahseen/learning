from datetime import UTC, datetime, timedelta
from functools import wraps

import jwt
from flask import g, jsonify, request

from config import Config


def create_token(user_id: int) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {"sub": str(user_id), "iat": now, "exp": now + timedelta(hours=Config.JWT_EXPIRES_HOURS)},
        Config.JWT_SECRET,
        algorithm="HS256",
    )


def auth_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "Authorization token is required"}), 401

        try:
            payload = jwt.decode(header.removeprefix("Bearer "), Config.JWT_SECRET, algorithms=["HS256"])
            g.user_id = int(payload["sub"])
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError, ValueError):
            return jsonify({"error": "Invalid or expired token"}), 401

        return view(*args, **kwargs)

    return wrapped
