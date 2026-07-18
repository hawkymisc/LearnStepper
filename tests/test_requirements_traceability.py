from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = ROOT / "ai-learning-app-requirements"
TRACEABILITY = ROOT / "docs" / "requirements-traceability.yaml"
NOT_IMPLEMENTED = ROOT / "not-implemented-functionalities.md"


class RequirementsTraceabilityTest(unittest.TestCase):
    def test_every_must_requirement_and_acceptance_criterion_is_classified_once(self) -> None:
        functional = (REQUIREMENTS / "03_機能要件.md").read_text(encoding="utf-8")
        acceptance = (REQUIREMENTS / "08_品質評価・受入基準・リスク.md").read_text(encoding="utf-8")
        expected_functional = set(re.findall(r"^\| (FR-[A-Z][0-9]+) .*\| Must \|$", functional, re.MULTILINE))
        expected_acceptance = set(re.findall(r"^### (AC-[0-9]+) ", acceptance, re.MULTILINE))

        traceability = yaml.safe_load(TRACEABILITY.read_text(encoding="utf-8"))
        functional_entries = self._expand(traceability["functional_requirements"])
        acceptance_entries = self._expand(traceability["acceptance_criteria"])

        self.assertEqual(expected_functional, set(functional_entries))
        self.assertEqual(expected_acceptance, set(acceptance_entries))
        self.assertEqual(len(expected_functional), len(functional_entries))
        self.assertEqual(len(expected_acceptance), len(acceptance_entries))

    def test_implemented_entries_have_evidence_and_deferred_entries_have_hold_ids(self) -> None:
        traceability = yaml.safe_load(TRACEABILITY.read_text(encoding="utf-8"))
        not_implemented = NOT_IMPLEMENTED.read_text(encoding="utf-8")
        for section in ("functional_requirements", "acceptance_criteria"):
            for group in traceability[section]:
                self.assertIn(group["status"], {"implemented", "deferred"})
                self.assertTrue(group["ids"])
                if group["status"] == "implemented":
                    self.assertTrue(group["code"])
                    self.assertTrue(group["tests"])
                else:
                    self.assertRegex(group["hold"], r"^NIF-[0-9]+$")
                    self.assertIn(group["hold"], not_implemented)

    @staticmethod
    def _expand(groups: list[dict]) -> list[str]:
        return [requirement_id for group in groups for requirement_id in group["ids"]]


if __name__ == "__main__":
    unittest.main()
