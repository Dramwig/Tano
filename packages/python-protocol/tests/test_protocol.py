import unittest

from tano_page import (
    WORKSPACE_CAPABILITY_PATH,
    WORKSPACE_RELATION_PATH,
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


if __name__ == "__main__":
    unittest.main()
