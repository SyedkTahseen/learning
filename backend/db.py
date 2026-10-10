from mysql.connector import Error, pooling

from config import Config

_pool = None


def get_connection():
    """Return a connection from a small reusable MySQL connection pool."""
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="task_manager_pool", pool_size=5, pool_reset_session=True, **Config.DB_CONFIG
        )
    return _pool.get_connection()


def database_error_response(error: Error):
    return {"error": "Database operation failed", "details": str(error)}, 500
