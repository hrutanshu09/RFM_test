from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def send(user_id: int, message: str) -> None:
    """
    Dispatch a notification to a user.

    This is a lightweight abstraction that can be replaced later with
    email, in-app alerts, or websockets without changing API handlers.
    """
    if user_id is None:
        return
    logger.info("Notify user %s: %s", user_id, message)
