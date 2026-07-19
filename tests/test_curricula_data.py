from __future__ import annotations

import hashlib
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
STRUCTURED_DIR = ROOT / "curricula" / "structured"
EXPECTED_FILES = {
    "01_japan.yaml",
    "02_us_dc.yaml",
    "03_us_new_york.yaml",
    "04_us_california.yaml",
    "05_de_berlin.yaml",
    "06_de_hamburg.yaml",
    "07_de_bavaria.yaml",
    "08_uae.yaml",
}


class CurriculumDataTest(unittest.TestCase):
    def test_exactly_eight_curriculum_profiles_exist(self) -> None:
        actual = {path.name for path in STRUCTURED_DIR.glob("[0-9][0-9]_*.yaml")}
        self.assertEqual(EXPECTED_FILES, actual)

    def test_required_fields_sources_hashes_and_terminology(self) -> None:
        profile_ids: set[str] = set()

        for filename in sorted(EXPECTED_FILES):
            with self.subTest(filename=filename):
                document = yaml.safe_load((STRUCTURED_DIR / filename).read_text(encoding="utf-8"))
                self.assertEqual("1.0", document["schema_version"])

                profile = document["profile"]
                profile_id = profile["id"]
                self.assertNotIn(profile_id, profile_ids)
                profile_ids.add(profile_id)
                for field in (
                    "country_code",
                    "jurisdiction_code",
                    "jurisdiction_name",
                    "authority",
                ):
                    self.assertTrue(profile[field])

                curriculum = document["curriculum"]
                for field in ("official_name", "subject", "education_stage", "version", "language"):
                    self.assertTrue(curriculum[field])
                self.assertTrue(curriculum["items"])

                terminology = document["terminology"]
                self.assertTrue(terminology["canonical_terms"])
                term_ids = [term["id"] for term in terminology["canonical_terms"]]
                self.assertEqual(len(term_ids), len(set(term_ids)))

                sources = document["source_documents"]
                self.assertTrue(sources)
                for source in sources:
                    local_path = ROOT / source["local_path"]
                    self.assertTrue(source["url"].startswith("https://"))
                    self.assertEqual("2026-07-18", str(source["retrieved_at"]))
                    if source.get("retrieval_status", "").startswith("failed_"):
                        self.assertTrue(local_path.is_file(), local_path)
                        self.assertEqual(0, local_path.stat().st_size)
                    elif local_path.exists():
                        self.assertTrue(local_path.is_file(), local_path)
                        self.assertGreater(local_path.stat().st_size, 0)

                    if local_path.exists():
                        digest = hashlib.sha256(local_path.read_bytes()).hexdigest()
                        self.assertEqual(source["sha256"], digest)


if __name__ == "__main__":
    unittest.main()
