"""Logging setup shared by the app and standalone scripts."""

import logging


def configure_logging(level: str = "INFO") -> None:
    """Configure root logging once, in a format that is useful in containers."""
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        force=True,
    )
