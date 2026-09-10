-- Chatr admin platform (phase 5): features management, improvement proposals,
-- AI request logging, and the manage_features permission.
--
-- Security model:
--   * All new tables are service-role-only. No tenant RLS policies; tenants
--     are hard-denied via revoke + RLS-with-no-policies on every table.
--   * Features are toggled server-side — the API refuses a request for a
--     disabled feature before any provider code runs.
--   * Improvement proposals are an admin-only audit trail. No code execution
--     happens from this table; it is purely for review/approval workflows.
--   * AI request logging is fire-and-forget from the chat route; it stores
--     no message content and no API keys.

-- ------------------------------------------------------------------
-- features: safe registry of app capabilities
-- ------------------------------------------------------------------
create table public.features (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  enabled boolean not null default false,
  available_to_users boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index features_key_idx on public.features (key);

alter table public.features enable row level security;
-- No tenant policies — hard-deny all non-service-role access.

-- ------------------------------------------------------------------
-- Seed curated feature registry (idempotent)
-- ------------------------------------------------------------------
insert into public.features (key, name, description, version, enabled, available_to_users) values
  ('pdf_analysis',      'PDF Analysis',          'Extract and analyze content from PDF files', 1, true,  true),
  ('image_generation',  'Image Generation',      'Generate images from text prompts',           1, true,  true),
  ('image_understanding','Image Understanding','Analyze and describe images',                  1, true,  true),
  ('web_search',        'Web Search',            'Search the web for real-time information',    1, true,  true),
  ('file_analysis',     'File Analysis',         'Analyze uploaded files across formats',       1, true,  true),
  ('voice',             'Voice',                 'Voice input and output capabilities',         1, true,  true),
  ('transcription',     'Transcription',         'Transcribe audio and speech to text',         1, true,  true),
  ('excel_analysis',    'Excel Analysis',        'Analyze and process Excel spreadsheets',      1, true,  true),
  ('word_analysis',     'Word Analysis',         'Analyze and process Word documents',          1, true,  true),
  ('powerpoint_analysis','PowerPoint Analysis', 'Analyze and process PowerPoint presentations',1, true,  true),
  ('advanced_tools',    'Advanced Tools',        'Advanced AI tools and utilities',             1, true,  true)
on conflict (key) do nothing;

-- ------------------------------------------------------------------
-- improvement_proposals: admin-only self-improvement audit trail
-- ------------------------------------------------------------------
create table public.improvement_proposals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null default 'proposed'
    check (status in ('proposed','approved','rejected','implemented')),
  proposed_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  review_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index improvement_proposals_status_idx on public.improvement_proposals (status, created_at desc);

alter table public.improvement_proposals enable row level security;
-- No tenant policies.

-- ------------------------------------------------------------------
-- ai_request_log: per-request telemetry for dashboard stats
-- ------------------------------------------------------------------
create table public.ai_request_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create index ai_request_log_created_idx on public.ai_request_log (created_at desc);

alter table public.ai_request_log enable row level security;
-- No tenant policies.

-- ------------------------------------------------------------------
-- admin_permissions: add manage_features permission
-- ------------------------------------------------------------------
-- Drop the old CHECK constraint and re-create with the new value.
-- Safe: all existing rows remain valid (adding a new value).
alter table public.admin_permissions
  drop constraint admin_permissions_permission_check;

alter table public.admin_permissions
  add constraint admin_permissions_permission_check
  check (permission in (
    -- USER_MANAGEMENT
    'view_users',
    'disable_users',
    'manage_user_roles',
    'view_user_activity',
    -- AI_PROVIDERS
    'view_providers',
    'view_model_config',
    'manage_provider_availability',
    'manage_usage_limits',
    -- SYSTEM
    'view_system_health',
    'view_system_errors',
    'view_usage_stats',
    'manage_app_settings',
    -- SECURITY
    'view_audit_logs',
    'view_active_sessions',
    'revoke_user_sessions',
    'view_failed_auth',
    -- SELF_DEVELOPMENT
    'create_dev_requests',
    'approve_dev_plans',
    'approve_deployments',
    -- FEATURES
    'manage_features'
  ));

-- ------------------------------------------------------------------
-- Hard-deny tenant access to all new tables
-- ------------------------------------------------------------------
revoke all on public.features from anon;
revoke all on public.features from authenticated;

revoke all on public.improvement_proposals from anon;
revoke all on public.improvement_proposals from authenticated;

revoke all on public.ai_request_log from anon;
revoke all on public.ai_request_log from authenticated;
