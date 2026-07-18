from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from learnstepper.errors import ApplicationError, validation_error
from learnstepper.persistence.contracts import DatabaseSession


class CurriculumImporter:
    """Imports repository-owned curriculum summaries without external I/O."""

    def __init__(self, curricula_dir: Path, now: str) -> None:
        self._curricula_dir = curricula_dir
        self._now = now

    def import_all(self, session: DatabaseSession) -> None:
        paths = sorted(self._curricula_dir.glob("[0-9][0-9]_*.yaml"))
        if not paths:
            raise ApplicationError("VALIDATION_ERROR", "No structured curriculum files found")
        for path in paths:
            document = yaml.safe_load(path.read_text(encoding="utf-8"))
            self._import_document(session, path, document)

    def _import_document(self, session: DatabaseSession, path: Path, document: dict[str, Any]) -> None:
        if document.get("schema_version") != "1.0":
            raise validation_error(f"Unsupported curriculum schema in {path.name}")
        profile = self._mapping(document, "profile", path)
        scope = self._mapping(document, "mvp_scope", path)
        curriculum = self._mapping(document, "curriculum", path)
        profile_id = self._text(profile, "id", path)
        status = self._text(scope, "status", path)
        if status not in {"included", "excluded"}:
            raise validation_error(f"Invalid MVP scope in {path.name}")

        profile_values = {
            "id": profile_id,
            "country_code": self._text(profile, "country_code", path),
            "jurisdiction_code": self._text(profile, "jurisdiction_code", path),
            "jurisdiction_name": self._text(profile, "jurisdiction_name", path),
            "jurisdiction_type": self._text(profile, "jurisdiction_type", path),
            "authority": self._text(profile, "authority", path),
            "mvp_status": status,
            "metadata_json": self._json({"mvp_scope": scope}),
            "source_file": path.name,
            "imported_at": self._now,
        }
        self._upsert(
            session,
            "curriculum_profiles",
            profile_values,
            key="id",
            mutable=tuple(name for name in profile_values if name != "id"),
        )

        curriculum_id = f"{profile_id}:curriculum"
        curriculum_values = {
            "id": curriculum_id,
            "profile_id": profile_id,
            "official_name": self._text(curriculum, "official_name", path),
            "subject": self._text(curriculum, "subject", path),
            "education_stage": self._text(curriculum, "education_stage", path),
            "grade_or_level_json": self._json(curriculum.get("grade_or_level", [])),
            "version": self._text(curriculum, "version", path),
            "effective_from": self._optional_text(curriculum.get("effective_from")),
            "language": self._text(curriculum, "language", path),
            "status": "active" if status == "included" else "excluded",
            "metadata_json": self._json(
                {
                    key: value
                    for key, value in curriculum.items()
                    if key
                    not in {
                        "official_name",
                        "subject",
                        "education_stage",
                        "grade_or_level",
                        "version",
                        "effective_from",
                        "language",
                        "items",
                    }
                }
            ),
        }
        self._upsert(
            session,
            "curricula",
            curriculum_values,
            key="id",
            mutable=tuple(name for name in curriculum_values if name != "id"),
        )

        source_ids: list[str] = []
        for source in document.get("source_documents", []):
            source_id = self._text(source, "id", path)
            source_ids.append(source_id)
            retrieval_status = str(source.get("retrieval_status", "success"))
            source_values = {
                "id": source_id,
                "url": self._text(source, "url", path),
                "canonical_url": self._text(source, "url", path),
                "title": self._text(source, "title", path),
                "publisher": self._text(source, "publisher", path),
                "source_type": "official_curriculum"
                if str(source.get("trust_level", "")).startswith("official")
                else "supplementary",
                "language": str(curriculum.get("language", "")) or None,
                "published_at": None,
                "document_version": str(curriculum.get("version", "")) or None,
                "license": self._optional_text(source.get("license")),
                "trust_level": self._text(source, "trust_level", path),
                "retrieved_at": str(source.get("retrieved_at", "")),
                "content_hash": self._optional_text(source.get("sha256")),
                "retrieval_status": retrieval_status,
                "local_path": self._optional_text(source.get("local_path")),
                "metadata_json": self._json(
                    {
                        key: value
                        for key, value in source.items()
                        if key
                        not in {
                            "id",
                            "url",
                            "title",
                            "publisher",
                            "license",
                            "trust_level",
                            "retrieved_at",
                            "sha256",
                            "retrieval_status",
                            "local_path",
                        }
                    }
                ),
            }
            self._upsert(
                session,
                "source_documents",
                source_values,
                key="id",
                mutable=tuple(name for name in source_values if name != "id"),
            )

        self._import_items(
            session,
            curriculum_id=curriculum_id,
            profile_id=profile_id,
            items=curriculum.get("items", []),
            parent_id=None,
            parent_path="",
            source_ids=source_ids,
        )

    def _import_items(
        self,
        session: DatabaseSession,
        *,
        curriculum_id: str,
        profile_id: str,
        items: list[dict[str, Any]],
        parent_id: str | None,
        parent_path: str,
        source_ids: list[str],
    ) -> None:
        for order, item in enumerate(items):
            code = str(item.get("code", "")).strip()
            title = str(item.get("title", "")).strip()
            if not code or not title:
                raise validation_error(f"Curriculum item code/title missing for {profile_id}")
            item_path = f"{parent_path}/{code}" if parent_path else code
            item_id = f"{profile_id}:{item_path}"
            metadata = {
                key: value
                for key, value in item.items()
                if key not in {"code", "title", "description", "item_type", "children"}
            }
            values = {
                "id": item_id,
                "curriculum_id": curriculum_id,
                "profile_id": profile_id,
                "parent_id": parent_id,
                "code": code,
                "title": title,
                "description": self._optional_text(item.get("description")),
                "item_type": self._optional_text(item.get("item_type")),
                "display_order": order,
                "metadata_json": self._json(metadata),
            }
            self._upsert(
                session,
                "curriculum_items",
                values,
                key="id",
                mutable=tuple(name for name in values if name != "id"),
            )
            for source_id in source_ids:
                mapping = session.fetchone(
                    "SELECT curriculum_item_id FROM curriculum_source_mappings "
                    "WHERE curriculum_item_id = ? AND source_document_id = ?",
                    (item_id, source_id),
                )
                if mapping is None:
                    session.execute(
                        "INSERT INTO curriculum_source_mappings"
                        "(curriculum_item_id, source_document_id, relationship, evidence_range, verification_status) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (item_id, source_id, "defined_by", None, "verified_metadata"),
                    )
            children = item.get("children", [])
            if children:
                self._import_items(
                    session,
                    curriculum_id=curriculum_id,
                    profile_id=profile_id,
                    items=children,
                    parent_id=item_id,
                    parent_path=item_path,
                    source_ids=source_ids,
                )

    @staticmethod
    def _upsert(
        session: DatabaseSession,
        table: str,
        values: dict[str, Any],
        *,
        key: str,
        mutable: tuple[str, ...],
    ) -> None:
        found = session.fetchone(f"SELECT {key} FROM {table} WHERE {key} = ?", (values[key],))
        if found is None:
            columns = tuple(values)
            placeholders = ", ".join("?" for _ in columns)
            session.execute(
                f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
                tuple(values[column] for column in columns),
            )
            return
        assignments = ", ".join(f"{column} = ?" for column in mutable)
        session.execute(
            f"UPDATE {table} SET {assignments} WHERE {key} = ?",
            tuple(values[column] for column in mutable) + (values[key],),
        )

    @staticmethod
    def _mapping(document: dict[str, Any], key: str, path: Path) -> dict[str, Any]:
        value = document.get(key)
        if not isinstance(value, dict):
            raise validation_error(f"{key} is missing in {path.name}")
        return value

    @staticmethod
    def _text(document: dict[str, Any], key: str, path: Path) -> str:
        value = str(document.get(key, "")).strip()
        if not value:
            raise validation_error(f"{key} is missing in {path.name}")
        return value

    @staticmethod
    def _optional_text(value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _json(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
