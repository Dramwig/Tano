"""Path classification does not validate filesystem access or authorize writes."""

import hashlib
import re

WORKSPACE_DATA_DIRECTORY = ".tano"
OBJECT_DIRECTORY = ".tano/objects"
WORKSPACE_CAPABILITY_PATH = ".tano/capabilities.json"
WORKSPACE_FOLDER_REGISTRY_PATH = ".tano/folders.tano.json"
WORKSPACE_SETTINGS_PATH = ".tano/settings.tano.json"
WORKSPACE_PLUGIN_PATH = ".tano/plugins.tano.json"
WORKSPACE_RELATION_PATH = ".tano/relations.tano-relations.json"
ASSISTANT_RULES_PATH = ".tano/rules/assistant.md"
ANNOTATION_DIRECTORY = ".tano/annotations"
DISCUSSION_DIRECTORY = ".tano/discussions"
TEMPLATE_DIRECTORY = ".tano/templates"
WORKSPACE_VIEW_DIRECTORY = ".tano/views"

_TEMPLATE_PATH_RE = re.compile(r"^\.tano/templates/[0-9a-f]{6}\.md$")
_WORKSPACE_VIEW_PATH_RE = re.compile(r"^\.tano/views/[a-zA-Z0-9_-]{1,64}\.tano\.json$")
_SHORT_ID_SIDECAR_PATH_RE = re.compile(
    r"^\.tano/(?:annotations|discussions|document-layout|suggestions|tables|files)/[0-9a-f]{6}\.tano\.json$"
)


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
        path
        in (
            WORKSPACE_CAPABILITY_PATH,
            WORKSPACE_FOLDER_REGISTRY_PATH,
            WORKSPACE_SETTINGS_PATH,
            WORKSPACE_PLUGIN_PATH,
            WORKSPACE_RELATION_PATH,
            ASSISTANT_RULES_PATH,
        )
        or _TEMPLATE_PATH_RE.match(path) is not None
        or _WORKSPACE_VIEW_PATH_RE.match(path) is not None
        or (path.startswith(".tano/conflicts/") and path.endswith(".json"))
        or (path.startswith(".tano/objects/") and path.endswith(".tano.json"))
        or _SHORT_ID_SIDECAR_PATH_RE.match(path) is not None
    )
