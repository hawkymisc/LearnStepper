from __future__ import annotations

# SQLite-specific DDL is intentionally isolated here. A DuckDB adapter supplies
# its own migration set while sharing the Database port and application/domain code.
SQLITE_SCHEMA_VERSION = 1

SQLITE_SCHEMA = r"""
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_profiles (
    id TEXT PRIMARY KEY,
    singleton_key INTEGER NOT NULL UNIQUE CHECK (singleton_key = 1),
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    locale TEXT NOT NULL CHECK (length(trim(locale)) > 0),
    timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
    learning_preferences_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS curriculum_profiles (
    id TEXT PRIMARY KEY,
    country_code TEXT NOT NULL,
    jurisdiction_code TEXT NOT NULL,
    jurisdiction_name TEXT NOT NULL,
    jurisdiction_type TEXT NOT NULL CHECK (jurisdiction_type IN ('national','state','land','federal_district')),
    authority TEXT NOT NULL,
    mvp_status TEXT NOT NULL CHECK (mvp_status IN ('included','excluded')),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    source_file TEXT NOT NULL,
    imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS curricula (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES curriculum_profiles(id),
    official_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    education_stage TEXT NOT NULL,
    grade_or_level_json TEXT NOT NULL,
    version TEXT NOT NULL,
    effective_from TEXT,
    language TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(profile_id, official_name, version)
);

CREATE TABLE IF NOT EXISTS curriculum_items (
    id TEXT PRIMARY KEY,
    curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES curriculum_profiles(id),
    parent_id TEXT REFERENCES curriculum_items(id),
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    item_type TEXT,
    display_order INTEGER NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(curriculum_id, parent_id, code)
);

CREATE TABLE IF NOT EXISTS curriculum_item_prerequisites (
    item_id TEXT NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
    prerequisite_item_id TEXT NOT NULL REFERENCES curriculum_items(id),
    PRIMARY KEY(item_id, prerequisite_item_id),
    CHECK (item_id <> prerequisite_item_id)
);

CREATE TABLE IF NOT EXISTS source_documents (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    publisher TEXT NOT NULL,
    source_type TEXT NOT NULL,
    language TEXT,
    published_at TEXT,
    document_version TEXT,
    license TEXT,
    trust_level TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    content_hash TEXT,
    retrieval_status TEXT NOT NULL,
    local_path TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS curriculum_source_mappings (
    curriculum_item_id TEXT NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id),
    relationship TEXT NOT NULL,
    evidence_range TEXT,
    verification_status TEXT NOT NULL,
    PRIMARY KEY(curriculum_item_id, source_document_id)
);

CREATE TABLE IF NOT EXISTS curriculum_objectives (
    id TEXT PRIMARY KEY,
    curriculum_item_id TEXT NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES curriculum_profiles(id),
    official_code TEXT,
    original_text TEXT NOT NULL,
    language TEXT NOT NULL,
    source_document_id TEXT REFERENCES source_documents(id),
    locator TEXT,
    display_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_projects (
    id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL REFERENCES local_profiles(id),
    mode TEXT NOT NULL CHECK (mode IN ('curriculum','free_topic')),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    topic TEXT NOT NULL CHECK (length(trim(topic)) > 0),
    purpose TEXT NOT NULL CHECK (length(trim(purpose)) > 0),
    curriculum_id TEXT REFERENCES curricula(id),
    current_level TEXT NOT NULL,
    target_level TEXT NOT NULL,
    target_date TEXT,
    preferred_session_minutes INTEGER NOT NULL CHECK (preferred_session_minutes BETWEEN 1 AND 1440),
    constraints_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','paused','completed','archived','deleted')),
    archived_from_status TEXT,
    codex_thread_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK ((mode = 'curriculum' AND curriculum_id IS NOT NULL) OR (mode = 'free_topic' AND curriculum_id IS NULL))
);

CREATE TABLE IF NOT EXISTS deleted_project_tombstones (
    project_id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_plans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','superseded','invalid')),
    generation_reason TEXT NOT NULL,
    generated_by_model TEXT,
    prompt_version TEXT,
    curriculum_version TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, version)
);

CREATE TABLE IF NOT EXISTS plan_modules (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes > 0),
    display_order INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        status IN ('not_started','learning','needs_review','mastered','on_hold')
    )
);

CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
    module_id TEXT NOT NULL REFERENCES plan_modules(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes > 0),
    display_order INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        status IN ('not_started','learning','needs_review','mastered','on_hold')
    )
);

CREATE TABLE IF NOT EXISTS plan_entity_curriculum_items (
    entity_type TEXT NOT NULL CHECK (entity_type IN ('module','lesson','concept')),
    entity_id TEXT NOT NULL,
    curriculum_item_id TEXT NOT NULL REFERENCES curriculum_items(id),
    PRIMARY KEY(entity_type, entity_id, curriculum_item_id)
);

CREATE TABLE IF NOT EXISTS plan_entity_sources (
    entity_type TEXT NOT NULL CHECK (entity_type IN ('module','lesson','concept')),
    entity_id TEXT NOT NULL,
    source_document_id TEXT NOT NULL REFERENCES source_documents(id),
    PRIMARY KEY(entity_type, entity_id, source_document_id)
);

CREATE TABLE IF NOT EXISTS concepts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES learning_plans(id) ON DELETE CASCADE,
    concept_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    importance REAL NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
    UNIQUE(plan_id, concept_key)
);

CREATE TABLE IF NOT EXISTS concept_prerequisites (
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    prerequisite_concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    PRIMARY KEY(concept_id, prerequisite_concept_id),
    CHECK (concept_id <> prerequisite_concept_id)
);

CREATE TABLE IF NOT EXISTS concept_mastery (
    id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL REFERENCES local_profiles(id),
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('not_started','learning','needs_review','mastered','on_hold')),
    mastery_score REAL NOT NULL CHECK (mastery_score BETWEEN 0 AND 1),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    last_evaluated_at TEXT NOT NULL,
    next_review_at TEXT,
    UNIQUE(local_profile_id, project_id, concept_id)
);

CREATE TABLE IF NOT EXISTS learning_objectives (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    current_version_id TEXT,
    lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('active','invalidated')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_objective_versions (
    id TEXT PRIMARY KEY,
    learning_objective_id TEXT NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    plan_id TEXT REFERENCES learning_plans(id),
    module_id TEXT REFERENCES plan_modules(id),
    lesson_id TEXT REFERENCES lessons(id),
    scope TEXT NOT NULL CHECK (scope IN ('project','module','lesson')),
    goal_type TEXT NOT NULL CHECK (goal_type IN ('can_do','know')),
    statement TEXT NOT NULL CHECK (length(trim(statement)) > 0),
    target TEXT NOT NULL CHECK (length(trim(target)) > 0),
    conditions TEXT NOT NULL CHECK (length(trim(conditions)) > 0),
    success_criteria TEXT NOT NULL CHECK (length(trim(success_criteria)) > 0),
    evidence_method TEXT NOT NULL CHECK (length(trim(evidence_method)) > 0),
    curriculum_item_ids_json TEXT NOT NULL,
    curriculum_objective_ids_json TEXT NOT NULL,
    source_document_ids_json TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(learning_objective_id, version_number),
    CHECK (
      (scope = 'project' AND plan_id IS NULL AND module_id IS NULL AND lesson_id IS NULL) OR
      (scope = 'module' AND plan_id IS NOT NULL AND module_id IS NOT NULL AND lesson_id IS NULL) OR
      (scope = 'lesson' AND plan_id IS NOT NULL AND module_id IS NOT NULL AND lesson_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS learning_objective_curriculum_mappings (
    learning_objective_version_id TEXT NOT NULL REFERENCES learning_objective_versions(id) ON DELETE CASCADE,
    curriculum_objective_id TEXT NOT NULL REFERENCES curriculum_objectives(id),
    transformation_version TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    verified_at TEXT,
    PRIMARY KEY(learning_objective_version_id, curriculum_objective_id)
);

CREATE TABLE IF NOT EXISTS assessments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    lesson_id TEXT REFERENCES lessons(id),
    type TEXT NOT NULL CHECK (type IN ('diagnostic','practice','lesson_check','final_check')),
    difficulty TEXT,
    rubric_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    curriculum_item_ids_json TEXT NOT NULL,
    source_document_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_objectives (
    assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    learning_objective_version_id TEXT NOT NULL REFERENCES learning_objective_versions(id),
    PRIMARY KEY(assessment_id, learning_objective_version_id)
);

CREATE TABLE IF NOT EXISTS assessment_attempts (
    id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    local_profile_id TEXT NOT NULL REFERENCES local_profiles(id),
    answer TEXT NOT NULL,
    score REAL,
    evaluation TEXT NOT NULL,
    rubric TEXT NOT NULL,
    hint_count INTEGER NOT NULL CHECK (hint_count >= 0),
    grading_status TEXT NOT NULL CHECK (grading_status IN ('graded','ambiguous','ungradable')),
    started_at TEXT NOT NULL,
    submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objective_evidence (
    id TEXT PRIMARY KEY,
    objective_id TEXT NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
    learning_objective_version_id TEXT NOT NULL REFERENCES learning_objective_versions(id),
    evidence_type TEXT NOT NULL CHECK (
        evidence_type IN ('diagnostic','practice','lesson_check','final_check','self_assessment')
    ),
    assessment_attempt_id TEXT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    result TEXT NOT NULL,
    score REAL,
    success_criteria_snapshot TEXT NOT NULL,
    rubric_version TEXT NOT NULL,
    evaluator_model TEXT,
    prompt_version TEXT,
    accepted_for_attainment INTEGER NOT NULL CHECK (accepted_for_attainment IN (0,1)),
    rejection_reason TEXT,
    verified_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objective_attainment (
    id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL REFERENCES local_profiles(id),
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    objective_id TEXT NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
    learning_objective_version_id TEXT NOT NULL REFERENCES learning_objective_versions(id),
    status TEXT NOT NULL CHECK (status IN ('not_started','in_progress','needs_review','achieved','invalidated')),
    evidence_ids_json TEXT NOT NULL,
    evaluated_at TEXT NOT NULL,
    invalidated_at TEXT,
    invalidation_reason TEXT,
    UNIQUE(local_profile_id, objective_id, learning_objective_version_id)
);

CREATE TABLE IF NOT EXISTS remediation_paths (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    trigger_concept_id TEXT REFERENCES concepts(id),
    origin_lesson_id TEXT REFERENCES lessons(id),
    remediation_lesson_ids_json TEXT NOT NULL,
    return_conditions TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('proposed','active','completed','dismissed')),
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    lesson_id TEXT REFERENCES lessons(id),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active','completed','interrupted','failed')),
    summary TEXT,
    next_action TEXT,
    active_turn_id TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
    codex_thread_id TEXT,
    codex_turn_id TEXT,
    codex_item_id TEXT,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    item_type TEXT NOT NULL,
    content TEXT NOT NULL,
    source_document_ids_json TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('completed','interrupted','failed')),
    created_at TEXT NOT NULL,
    UNIQUE(session_id, sequence)
);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL REFERENCES local_profiles(id),
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    lesson_id TEXT REFERENCES lessons(id),
    concept_id TEXT REFERENCES concepts(id),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    source_document_ids_json TEXT NOT NULL,
    curriculum_item_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL REFERENCES local_profiles(id),
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    lesson_id TEXT REFERENCES lessons(id),
    concept_id TEXT REFERENCES concepts(id),
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    note TEXT,
    source_document_ids_json TEXT NOT NULL,
    curriculum_item_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
    request_id TEXT PRIMARY KEY,
    command_name TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_profile_status ON learning_projects(local_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_project_status ON learning_plans(project_id, status);
CREATE INDEX IF NOT EXISTS idx_objectives_project ON learning_objectives(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_started ON learning_sessions(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_sequence ON messages(session_id, sequence);
"""
