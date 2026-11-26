import json
from pathlib import Path
import unittest

from tano_page_protocol import (
    ANNOTATION_DIRECTORY,
    ASSISTANT_RULES_PATH,
    DISCUSSION_DIRECTORY,
    OBJECT_DIRECTORY,
    TEMPLATE_DIRECTORY,
    WORKSPACE_CAPABILITY_PATH,
    WORKSPACE_DATA_DIRECTORY,
    WORKSPACE_FOLDER_REGISTRY_PATH,
    WORKSPACE_PLUGIN_PATH,
    WORKSPACE_RELATION_PATH,
    WORKSPACE_SETTINGS_PATH,
    WORKSPACE_VIEW_DIRECTORY,
    content_hash,
    is_short_id,
    is_workspace_data_path,
    is_workspace_internal_path,
)


class ProtocolTests(unittest.TestCase):
    def test_hashes_exact_content_bytes(self):
        self.assertEqual(
            content_hash(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )
        self.assertNotEqual(content_hash(b"# Notes\n"), content_hash(b"# Notes\r\n"))

    def test_reference_ids_do_not_accept_other_identity_formats(self):
        for valid in ("a1b2c3", "000000"):
            self.assertTrue(is_short_id(valid))
        for invalid in (
            "A1B2C3", "abcdef0", "12345", "a1b2cg", "\uff1123456", 123456,
            "550e8400-e29b-41d4-a716-446655440000",
        ):
            with self.subTest(value=invalid):
                self.assertFalse(is_short_id(invalid))

    def test_identity_and_caches_are_excluded_from_portable_data(self):
        for path in (
            WORKSPACE_CAPABILITY_PATH,
            WORKSPACE_SETTINGS_PATH,
            WORKSPACE_RELATION_PATH,
            ".tano/objects/a1b2c3.tano.json",
            ".tano/conflicts/conflict.json",
        ):
            self.assertTrue(is_workspace_internal_path(path))
            self.assertTrue(is_workspace_data_path(path))
        for path in (".tano/config.json", ".tano/cache.sqlite", ".tano/objects/a.json"):
            self.assertTrue(is_workspace_internal_path(path))
            self.assertFalse(is_workspace_data_path(path))
        self.assertTrue(is_workspace_internal_path(".tano"))
        self.assertFalse(is_workspace_internal_path(".tano-backup/config.json"))
        self.assertFalse(is_workspace_internal_path("notes/.tano/config.json"))

    def test_shared_protocol_vectors(self):
        vectors_path = Path(__file__).resolve().parents[2] / "protocol" / "protocol-vectors.json"
        if not vectors_path.exists():
            return
        vectors = json.loads(vectors_path.read_text(encoding="utf-8"))
        self.assertEqual(WORKSPACE_DATA_DIRECTORY, vectors["constants"]["WORKSPACE_DATA_DIRECTORY"])
        self.assertEqual(OBJECT_DIRECTORY, vectors["constants"]["OBJECT_DIRECTORY"])
        self.assertEqual(WORKSPACE_CAPABILITY_PATH, vectors["constants"]["WORKSPACE_CAPABILITY_PATH"])
        self.assertEqual(WORKSPACE_FOLDER_REGISTRY_PATH, vectors["constants"]["WORKSPACE_FOLDER_REGISTRY_PATH"])
        self.assertEqual(WORKSPACE_SETTINGS_PATH, vectors["constants"]["WORKSPACE_SETTINGS_PATH"])
        self.assertEqual(WORKSPACE_PLUGIN_PATH, vectors["constants"]["WORKSPACE_PLUGIN_PATH"])
        self.assertEqual(WORKSPACE_RELATION_PATH, vectors["constants"]["WORKSPACE_RELATION_PATH"])
        self.assertEqual(ASSISTANT_RULES_PATH, vectors["constants"]["ASSISTANT_RULES_PATH"])
        self.assertEqual(ANNOTATION_DIRECTORY, vectors["constants"]["ANNOTATION_DIRECTORY"])
        self.assertEqual(DISCUSSION_DIRECTORY, vectors["constants"]["DISCUSSION_DIRECTORY"])
        self.assertEqual(TEMPLATE_DIRECTORY, vectors["constants"]["TEMPLATE_DIRECTORY"])
        self.assertEqual(WORKSPACE_VIEW_DIRECTORY, vectors["constants"]["WORKSPACE_VIEW_DIRECTORY"])
        for item in vectors["hashes"]:
            self.assertEqual(content_hash(item["input"].encode("utf-8")), item["sha256"])
        for value in vectors["shortIds"]["valid"]:
            self.assertTrue(is_short_id(value))
        for value in vectors["shortIds"]["invalid"]:
            self.assertFalse(is_short_id(value))
        for value in vectors["workspaceInternalPaths"]["valid"]:
            self.assertTrue(is_workspace_internal_path(value))
        for value in vectors["workspaceInternalPaths"]["invalid"]:
            self.assertFalse(is_workspace_internal_path(value))
        for value in vectors["workspaceDataPaths"]["valid"]:
            self.assertTrue(is_workspace_data_path(value))
        for value in vectors["workspaceDataPaths"]["invalid"]:
            self.assertFalse(is_workspace_data_path(value))


if __name__ == "__main__":
    unittest.main()
