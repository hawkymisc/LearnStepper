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
        classifications: dict[str, tuple[str, set[str]]] = {}
        for section in ("functional_requirements", "acceptance_criteria"):
            for group in traceability[section]:
                self.assertIn(group["status"], {"implemented", "deferred"})
                self.assertTrue(group["ids"])
                holds = set(group.get("holds", []))
                for requirement_id in group["ids"]:
                    classifications[requirement_id] = (group["status"], holds)
                if group["status"] == "implemented":
                    self.assertFalse(holds, f"Implemented group has active holds: {group['name']}")
                    self.assertTrue(group["code"])
                    self.assertTrue(group["tests"])
                    for code_path in group["code"]:
                        self.assertTrue((ROOT / code_path).is_file(), code_path)
                    for evidence in group["tests"]:
                        self.assertIsInstance(evidence, dict)
                        test_path = ROOT / evidence["path"]
                        self.assertTrue(test_path.is_file(), test_path)
                        cases = evidence.get("cases", [])
                        self.assertTrue(cases, f"No semantic test selector for {group['name']}")
                        source = test_path.read_text(encoding="utf-8")
                        for case in cases:
                            self.assertRegex(source, rf"\bdef {re.escape(case)}\(")
                else:
                    self.assertTrue(holds, f"Deferred group has no holds: {group['name']}")
                    for hold in holds:
                        self.assertRegex(hold, r"^NIF-[0-9]+$")
                        self.assertRegex(not_implemented, rf"\| {re.escape(hold)} \|")

        active_must_holds = not_implemented.split("## 3. Deferred Should and Could functionality", 1)[0]
        for line in active_must_holds.splitlines():
            match = re.match(r"^\| (NIF-[0-9]+) \| ([^|]+) \|", line)
            if match is None:
                continue
            hold, requirement_cell = match.groups()
            for requirement_id in self._expand_hold_requirement_ids(requirement_cell):
                if requirement_id not in classifications:
                    continue
                status, declared_holds = classifications[requirement_id]
                self.assertEqual("deferred", status, f"{requirement_id} is both implemented and held by {hold}")
                self.assertIn(hold, declared_holds, f"{requirement_id} does not declare active hold {hold}")

    @staticmethod
    def _expand(groups: list[dict]) -> list[str]:
        return [requirement_id for group in groups for requirement_id in group["ids"]]

    @staticmethod
    def _expand_hold_requirement_ids(cell: str) -> set[str]:
        result = set(re.findall(r"(?:FR-[A-Z][0-9]+|AC-[0-9]+)", cell))
        for category, start, end_category, end in re.findall(r"FR-([A-Z])([0-9]+)[–-](?:FR-)?([A-Z]?)([0-9]+)", cell):
            if end_category and end_category != category:
                continue
            width = max(len(start), len(end))
            result.update(f"FR-{category}{value:0{width}d}" for value in range(int(start), int(end) + 1))
        return result


if __name__ == "__main__":
    unittest.main()
