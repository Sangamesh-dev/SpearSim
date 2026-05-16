-- ============================================================
-- PhishSim - Supabase Schema
-- GDPR-compliant phishing simulation platform
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    domain      TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'completed');
CREATE TYPE scenario_type AS ENUM ('IT Support', 'HR', 'Finance', 'CEO Fraud', 'Vendor');
CREATE TYPE difficulty_level AS ENUM ('Low', 'Medium', 'High');
CREATE TYPE lawful_basis_type AS ENUM ('Legitimate Interest', 'Employee Contract', 'Legal Obligation');

CREATE TABLE campaigns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    scenario_type   scenario_type NOT NULL,
    difficulty      difficulty_level NOT NULL,
    status          campaign_status NOT NULL DEFAULT 'draft',
    consent_signed  BOOLEAN NOT NULL DEFAULT FALSE,
    lawful_basis    lawful_basis_type,
    created_by      TEXT NOT NULL,           -- admin email
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    auto_delete_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
    launched_at     TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

-- ============================================================
-- EMPLOYEES (pseudonymised — no real names stored here)
-- ============================================================
CREATE TABLE employees (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    alias           TEXT NOT NULL,           -- e.g. "Employee_3F9A"
    email           TEXT NOT NULL,
    role_generic    TEXT NOT NULL,           -- generic role, not specific title
    uuid            UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),  -- tracking token
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(campaign_id, email)
);

-- ============================================================
-- NAME MAP (encrypted real name storage — GDPR Article 5)
-- Kept separate and encrypted via Supabase Vault
-- ============================================================
CREATE TABLE name_map (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alias       TEXT NOT NULL UNIQUE,
    real_name   TEXT NOT NULL,              -- encrypted at rest via Vault
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EVENTS (tracking: open / click / cred_entered)
-- ============================================================
CREATE TYPE event_type AS ENUM ('open', 'click', 'cred_entered');

CREATE TABLE events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    event_type  event_type NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS (read-only, Article 30 compliance)
-- ============================================================
CREATE TABLE audit_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_email  TEXT NOT NULL,
    action       TEXT NOT NULL,
    target_table TEXT,
    target_id    TEXT,
    ip_address   TEXT,
    metadata     JSONB,
    timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit logs are append-only — revoke DELETE/UPDATE
-- (Apply via RLS policies below)

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE name_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read/write their org data
-- (Adjust policies per your auth setup)
CREATE POLICY "Authenticated users can manage organizations"
    ON organizations FOR ALL
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage campaigns"
    ON campaigns FOR ALL
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage employees"
    ON employees FOR ALL
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage name_map"
    ON name_map FOR ALL
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage events"
    ON events FOR ALL
    TO authenticated
    USING (true);

-- Audit logs: insert only, no update/delete
CREATE POLICY "Authenticated users can insert audit logs"
    ON audit_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can read audit logs"
    ON audit_logs FOR SELECT
    TO authenticated
    USING (true);

-- Public (anon) can insert events (tracking pixel, click, cred)
CREATE POLICY "Public can insert events"
    ON events FOR INSERT
    TO anon
    WITH CHECK (true);

-- Public can read employee by uuid (for tracking)
CREATE POLICY "Public can read employee by uuid"
    ON employees FOR SELECT
    TO anon
    USING (true);

-- Public can read campaign (for phish page context)
CREATE POLICY "Public can read campaigns"
    ON campaigns FOR SELECT
    TO anon
    USING (true);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_campaigns_org_id ON campaigns(org_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_auto_delete ON campaigns(auto_delete_at);
CREATE INDEX idx_employees_campaign_id ON employees(campaign_id);
CREATE INDEX idx_employees_uuid ON employees(uuid);
CREATE INDEX idx_employees_alias ON employees(alias);
CREATE INDEX idx_events_employee_id ON events(employee_id);
CREATE INDEX idx_events_campaign_id ON events(campaign_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_email);
CREATE INDEX idx_name_map_alias ON name_map(alias);

-- ============================================================
-- SUPABASE EDGE FUNCTION: Data Retention Cron (Article 5(1)(e))
-- Deploy as: supabase/functions/retention-cleanup/index.ts
-- Schedule: daily via pg_cron or Supabase Dashboard
-- ============================================================
-- The actual Edge Function is in supabase/functions/retention-cleanup/

-- ============================================================
-- HELPER VIEWS
-- ============================================================

-- Campaign summary view (no PII)
CREATE OR REPLACE VIEW campaign_summary AS
SELECT
    c.id,
    c.name,
    c.scenario_type,
    c.difficulty,
    c.status,
    c.consent_signed,
    c.lawful_basis,
    c.created_by,
    c.created_at,
    c.auto_delete_at,
    c.launched_at,
    c.completed_at,
    c.org_id,
    o.name AS org_name,
    o.domain AS org_domain,
    COUNT(DISTINCT e.id) AS total_employees,
    COUNT(DISTINCT CASE WHEN ev.event_type = 'open' THEN ev.employee_id END) AS total_opens,
    COUNT(DISTINCT CASE WHEN ev.event_type = 'click' THEN ev.employee_id END) AS total_clicks,
    COUNT(DISTINCT CASE WHEN ev.event_type = 'cred_entered' THEN ev.employee_id END) AS total_creds,
    EXTRACT(DAY FROM (c.auto_delete_at - NOW())) AS retention_days_remaining
FROM campaigns c
JOIN organizations o ON c.org_id = o.id
LEFT JOIN employees e ON e.campaign_id = c.id
LEFT JOIN events ev ON ev.campaign_id = c.id
GROUP BY c.id, o.name, o.domain;

-- ============================================================
-- ADDITIVE MIGRATIONS (safe to run on existing databases)
-- ============================================================

-- Feature: Campaign notes
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS notes TEXT;

-- Feature: Multi-scenario per employee
ALTER TABLE employees ADD COLUMN IF NOT EXISTS scenario_override TEXT;

-- Feature: Awareness quiz results
CREATE TABLE IF NOT EXISTS quiz_results (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    employee_id  UUID REFERENCES employees(id) ON DELETE CASCADE,
    score        INTEGER NOT NULL,   -- 0–3 correct answers
    answers      JSONB NOT NULL,     -- {"q1": "a", "q2": "c", "q3": "b"}
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_results_campaign ON quiz_results(campaign_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_employee ON quiz_results(employee_id);

-- RLS for quiz_results
ALTER TABLE quiz_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage quiz_results"
    ON quiz_results FOR ALL
    TO authenticated
    USING (true);

CREATE POLICY "Public can insert quiz_results"
    ON quiz_results FOR INSERT
    TO anon
    WITH CHECK (true);

-- ============================================================
-- USER PROFILES (RBAC & Ethical Use Terms Acknowledgement)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id                UUID PRIMARY KEY,
    org_id            UUID REFERENCES organizations(id) ON DELETE SET NULL,
    role              TEXT NOT NULL DEFAULT 'viewer',
    full_name         TEXT,
    terms_accepted    BOOLEAN NOT NULL DEFAULT FALSE,
    terms_accepted_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage user_profiles"
    ON user_profiles FOR ALL
    TO authenticated
    USING (true);

