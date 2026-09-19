import copy
import unittest

from backend.app.migrations.legacy import MigrationError, migrate_legacy_payload


class LegacyMigrationTests(unittest.TestCase):
    def test_v5_migration_preserves_profile_facts_and_source_hash(self):
        raw = {
            "schemaVersion": 5,
            "dollName": "阿布",
            "avatar": "data:image/png;base64,abc",
            "onboardingPhase": "names-confirmed",
            "confirmedFacts": ["A 和 B 在同一个房间里。"],
            "names": {"A": "甲", "B": "乙"},
            "stage": {"roomId": "bedroom", "present": ["YOU", "A", "B"]},
            "nights": 3,
            "doubt": 2,
            "memories": {"A": ["他记得那盏灯。"]},
        }
        original = copy.deepcopy(raw)
        result = migrate_legacy_payload(raw)
        self.assertEqual(raw, original)
        self.assertEqual(result.world.room_id, "bedroom")
        self.assertEqual(result.world.metadata["profile"]["dollName"], "阿布")
        self.assertEqual(result.world.metadata["profile"]["confirmedFacts"], ["A 和 B 在同一个房间里。"])
        self.assertEqual(result.world.metadata["migration"]["from"], "voodoo-hex-v5")
        self.assertEqual(len(result.source_hash), 64)

    def test_v1_requires_explicit_source_and_bad_version_is_rejected(self):
        with self.assertRaises(MigrationError):
            migrate_legacy_payload({"schemaVersion": 4}, "voodoo-hex-v5")
        result = migrate_legacy_payload({"name": "旧娃娃", "avatar": "data:image/png;base64,abc"}, "voodoo-cabinet-v1")
        self.assertEqual(result.world.metadata["profile"]["dollName"], "旧娃娃")
        self.assertEqual(result.world.metadata["migration"]["from"], "voodoo-cabinet-v1")


if __name__ == "__main__":
    unittest.main()
