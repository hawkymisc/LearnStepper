from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from learnstepper.core import ApplicationCore, AttainmentPolicy
from learnstepper.persistence import SQLiteDatabase

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    payload = json.load(sys.stdin)
    with tempfile.TemporaryDirectory() as temporary_directory:
        core = ApplicationCore(
            database=SQLiteDatabase(Path(temporary_directory) / "learnstepper.sqlite3"),
            curricula_dir=ROOT / "curricula" / "structured",
            attainment_policy=AttainmentPolicy(minimum_score=0.8),
        )
        core.initialize()
        core.command(
            name="profile.update",
            payload={"display_name": "Learner", "locale": "ja-JP", "timezone": "Asia/Tokyo"},
            request_id="frontend-contract-profile",
        )
        project = core.command(
            name="project.create",
            payload=payload,
            request_id="frontend-contract-project",
        )
    json.dump(project, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
