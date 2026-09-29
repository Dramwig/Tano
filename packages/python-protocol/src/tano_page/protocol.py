"""Path classification does not validate filesystem access or authorize writes."""

import hashlib
import re

WORKSPACE_DATA_DIRECTORY = ".tano"
OBJECT_DIRECTORY = ".tano/objects"
WORKSPACE_CAPABILITY_PATH = ".tano/capabilities.json"
WORKSPACE_RELATION_PATH = ".tano/relations.tano-relations.json"


def content_hash(content: bytes) -> str:
    """Return the SHA-256 of exact bytes for Tano's expectedHash field."""
    return hashlib.sha256(content).hexdigest()


def is_short_id(value: object) -> bool:
    """Recognize six lowercase hexadecimal characters, separate from UUIDs."""
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{6}", value) is not None


def is_workspace_internal_path(path: str) -> bool:
    """Classify paths inside Tano's portable data directory."""
    return path == WORKSPACE_DATA_DIRECTORY or path.startswith(".tano/")


def is_workspace_data_path(path: str) -> bool:
    """Classify portable data paths, excluding workspace identity and app caches."""
    return (
        path in (WORKSPACE_CAPABILITY_PATH, WORKSPACE_RELATION_PATH)
        or (path.startswith(".tano/conflicts/") and path.endswith(".json"))
        or (path.startswith(".tano/objects/") and path.endswith(".tano.json"))
    )
