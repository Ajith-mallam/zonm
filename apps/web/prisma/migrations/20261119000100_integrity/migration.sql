-- ZONM NET database-level integrity controls.
--
-- M12 / F12.1, F12.3: AuditEvent is append-only and hash-chained. The chain is
-- built here, inside the database, so application code cannot forge or reorder
-- it, and concurrent writers cannot fork it.
-- F4.8: document originals and versions are immutable.
--
-- Production should also run the app as a role without UPDATE/DELETE/TRUNCATE on
-- "AuditEvent" and without ownership of these tables (owners can drop triggers).
-- See docs/SECURITY.md.

-- ───────────────────────────────────────────────────────────── audit chain

-- Canonical hash of one event. jsonb_build_array gives an unambiguous encoding
-- (NULL differs from '', and separators inside values are escaped), and jsonb's
-- text output is deterministic (keys sorted, fixed spacing).
CREATE FUNCTION audit_event_hash(
    p_prev text, p_seq bigint, p_at timestamptz, p_actor_id text, p_actor_email text,
    p_action text, p_entity_type text, p_entity_id text, p_case_id text,
    p_ip text, p_user_agent text, p_details jsonb
) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(
        p_prev, p_seq,
        to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id, p_case_id,
        p_ip, p_user_agent, p_details
    )::text, 'UTF8')), 'hex')
$$;

CREATE FUNCTION audit_event_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    last_seq  bigint;
    last_hash text;
BEGIN
    -- Serialise chain appends. The lock is held until the transaction commits,
    -- so the next writer always sees this row as the chain head.
    PERFORM pg_advisory_xact_lock(hashtext('zonm.audit_chain'));
    SELECT a.seq, a.hash INTO last_seq, last_hash
      FROM "AuditEvent" a ORDER BY a.seq DESC LIMIT 1;

    NEW.seq        := COALESCE(last_seq, 0) + 1;
    NEW.at         := date_trunc('microseconds', clock_timestamp());
    NEW."prevHash" := COALESCE(last_hash, repeat('0', 64));
    NEW.details    := COALESCE(NEW.details, '{}'::jsonb);
    NEW.hash       := audit_event_hash(
        NEW."prevHash", NEW.seq, NEW.at, NEW."actorId", NEW."actorEmail", NEW.action,
        NEW."entityType", NEW."entityId", NEW."caseId", NEW.ip, NEW."userAgent", NEW.details);
    RETURN NEW;
END
$$;

CREATE TRIGGER audit_event_chain
    BEFORE INSERT ON "AuditEvent"
    FOR EACH ROW EXECUTE FUNCTION audit_event_before_insert();

CREATE FUNCTION reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% on "%" is not permitted: the table is append-only', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER audit_event_no_update_delete
    BEFORE UPDATE OR DELETE ON "AuditEvent"
    FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TRIGGER audit_event_no_truncate
    BEFORE TRUNCATE ON "AuditEvent"
    FOR EACH STATEMENT EXECUTE FUNCTION reject_modification();

-- Verify the chain between two positions (inclusive). Returns one row per
-- problem found, so an empty result means the range is intact.
CREATE FUNCTION audit_verify_chain(p_from bigint DEFAULT 1, p_to bigint DEFAULT NULL)
RETURNS TABLE (seq bigint, problem text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r             "AuditEvent"%ROWTYPE;
    expected_prev text;
    expected_seq  bigint := p_from;
    computed      text;
BEGIN
    IF p_from <= 1 THEN
        expected_prev := repeat('0', 64);
    ELSE
        SELECT a.hash INTO expected_prev FROM "AuditEvent" a WHERE a.seq = p_from - 1;
        IF expected_prev IS NULL THEN
            seq := p_from - 1; problem := 'anchor event missing'; RETURN NEXT;
            RETURN;
        END IF;
    END IF;

    FOR r IN
        SELECT * FROM "AuditEvent" a
         WHERE a.seq >= p_from AND (p_to IS NULL OR a.seq <= p_to)
         ORDER BY a.seq
    LOOP
        IF r.seq <> expected_seq THEN
            seq := expected_seq; problem := format('gap: next event is seq %s', r.seq); RETURN NEXT;
        END IF;
        IF r."prevHash" <> expected_prev THEN
            seq := r.seq; problem := 'prevHash does not match the previous event hash'; RETURN NEXT;
        END IF;
        computed := audit_event_hash(
            r."prevHash", r.seq, r.at, r."actorId", r."actorEmail", r.action,
            r."entityType", r."entityId", r."caseId", r.ip, r."userAgent", r.details);
        IF r.hash <> computed THEN
            seq := r.seq; problem := 'hash does not match event contents'; RETURN NEXT;
        END IF;
        expected_prev := r.hash;
        expected_seq  := r.seq + 1;
    END LOOP;
END
$$;

-- ────────────────────────────────────────────── immutable evidence (F4.8)

CREATE FUNCTION document_protect_original() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."originalText" IS DISTINCT FROM OLD."originalText"
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW."caseId" IS DISTINCT FROM OLD."caseId"
       OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
       OR NEW."sourceFileId" IS DISTINCT FROM OLD."sourceFileId"
       OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'Document originals are immutable; create a DocumentVersion instead'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER document_original_immutable
    BEFORE UPDATE ON "Document"
    FOR EACH ROW EXECUTE FUNCTION document_protect_original();

CREATE TRIGGER document_version_immutable
    BEFORE UPDATE OR DELETE ON "DocumentVersion"
    FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE FUNCTION source_file_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW."storagePath" IS DISTINCT FROM OLD."storagePath"
       OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
       OR NEW."caseId" IS DISTINCT FROM OLD."caseId" THEN
        RAISE EXCEPTION 'Source file identity is immutable'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER source_file_immutable
    BEFORE UPDATE ON "SourceFile"
    FOR EACH ROW EXECUTE FUNCTION source_file_protect();

-- ───────────────────────────────────────────────────────── check constraints

ALTER TABLE "Document"
    ADD CONSTRAINT document_known_has_candidate
    CHECK (role <> 'KNOWN' OR "candidateId" IS NOT NULL);

ALTER TABLE "Document"
    ADD CONSTRAINT document_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE "DocumentVersion"
    ADD CONSTRAINT document_version_positive CHECK (version >= 1);

ALTER TABLE "SocialMonitor"
    ADD CONSTRAINT social_monitor_interval CHECK ("intervalMinutes" BETWEEN 5 AND 15);

ALTER TABLE "AnalysisRun"
    ADD CONSTRAINT analysis_run_progress CHECK (progress BETWEEN 0 AND 100);
