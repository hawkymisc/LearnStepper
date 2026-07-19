from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS_DIR = ROOT / "ai-learning-app-requirements"
MVP_PROFILE_IDS = {"jp-national", "us-dc", "us-ny", "us-ca", "de-be", "de-hh", "de-by"}


class MvpCurriculumScopeTest(unittest.TestCase):
    def test_requirements_define_seven_mvp_profiles_and_exclude_uae(self) -> None:
        index = (REQUIREMENTS_DIR / "00_INDEX.md").read_text(encoding="utf-8")
        scope = (REQUIREMENTS_DIR / "01_概要とスコープ.md").read_text(encoding="utf-8")
        use_cases = (REQUIREMENTS_DIR / "02_ユーザーとユースケース.md").read_text(encoding="utf-8")
        functional = (REQUIREMENTS_DIR / "03_機能要件.md").read_text(encoding="utf-8")
        data_model = (REQUIREMENTS_DIR / "05_システム構成とデータモデル.md").read_text(encoding="utf-8")
        api = (REQUIREMENTS_DIR / "06_API.md").read_text(encoding="utf-8")
        acceptance = (REQUIREMENTS_DIR / "08_品質評価・受入基準・リスク.md").read_text(encoding="utf-8")
        roadmap = (REQUIREMENTS_DIR / "09_ロードマップと未決事項.md").read_text(encoding="utf-8")

        documents = (index, scope, use_cases, functional, data_model, api, acceptance, roadmap)
        for document in documents:
            self.assertIn("7教育管轄プロファイル", document)

        self.assertIn("UAEはMVP対象外", scope)
        self.assertIn("### AC-09 7教育管轄プロファイル", acceptance)
        stale_mvp_scope = re.compile(r"(?:MVP.{0,30}8教育管轄|8教育管轄.{0,30}MVP)")
        for document in documents:
            self.assertIsNone(stale_mvp_scope.search(document))

    def test_uae_structured_record_is_retained_but_marked_out_of_scope(self) -> None:
        uae = yaml.safe_load((ROOT / "curricula" / "structured" / "08_uae.yaml").read_text(encoding="utf-8"))

        self.assertEqual("excluded", uae["mvp_scope"]["status"])
        self.assertEqual("official_curriculum_source_unavailable", uae["mvp_scope"]["reason"])

        included_profile_ids = set()
        for path in sorted((ROOT / "curricula" / "structured").glob("[0-9][0-9]_*.yaml")):
            document = yaml.safe_load(path.read_text(encoding="utf-8"))
            self.assertIn("mvp_scope", document)
            self.assertIn(document["mvp_scope"]["status"], {"included", "excluded"})
            if document["mvp_scope"]["status"] == "included":
                included_profile_ids.add(document["profile"]["id"])

        self.assertEqual(MVP_PROFILE_IDS, included_profile_ids)


if __name__ == "__main__":
    unittest.main()
