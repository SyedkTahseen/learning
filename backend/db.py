
import logging
from mysql.connector import Error, pooling
from config import Config

logger = logging.getLogger(__name__)
_pool = None


def get_connection():
    """Return a connection from a reusable MySQL pool."""
    global _pool

    if _pool is None:
        try:
            _pool = pooling.MySQLConnectionPool(
                pool_name="task_manager_pool",
                pool_size=5,
                pool_reset_session=True,
                **Config.DB_CONFIG
            )
        except Error:
            logger.exception("Failed to initialize MySQL connection pool")
            raise

    try:
        connection = _pool.get_connection()
        if not connection.is_connected():
            connection.reconnect(attempts=2, delay=1)
        return connection
    except Error:
        logger.exception("Failed to obtain MySQL connection")
        raise


def database_error_response(error: Error):
    logger.exception("Database operation failed", exc_info=error)
    return {
        "error": "Database operation failed",
        "details": "Check the server logs for the underlying database error."
    }, 500
