-- Audit is append-only at the database level, not only in application code.
CREATE OR REPLACE FUNCTION cardops_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER operations_append_only
BEFORE UPDATE OR DELETE ON operations
FOR EACH ROW EXECUTE FUNCTION cardops_forbid_mutation();
--> statement-breakpoint

-- A completed idempotent response must carry status and body.
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_completed_check
  CHECK (status <> 'completed' OR (response_status IS NOT NULL AND response_body IS NOT NULL));
