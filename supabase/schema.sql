-- Apply in the Supabase SQL editor. Keep the service role key only in the cron
-- host's environment; it bypasses RLS, so never expose it in a browser/client.

create schema if not exists vx_admin;

create table if not exists vx_admin.cloudflare_config (
  id uuid primary key default gen_random_uuid(),
  api_token text not null,
  updated_at timestamptz not null default now()
);

-- Migrate an earlier integer config ID to UUID so existing installations also
-- gain generated IDs. This project does not reference this ID from other tables.
do $$
declare
  constraint_row record;
  id_type text;
begin
  select data_type into id_type
  from information_schema.columns
  where table_schema = 'vx_admin'
    and table_name = 'cloudflare_config'
    and column_name = 'id';

  if id_type <> 'uuid' then
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'vx_admin.cloudflare_config'::regclass
        and contype in ('p', 'c')
    loop
      execute format('alter table vx_admin.cloudflare_config drop constraint %I', constraint_row.conname);
    end loop;

    alter table vx_admin.cloudflare_config alter column id drop default;
    alter table vx_admin.cloudflare_config alter column id type uuid using gen_random_uuid();
    alter table vx_admin.cloudflare_config alter column id set default gen_random_uuid();
    alter table vx_admin.cloudflare_config add primary key (id);
  end if;
end $$;

create table if not exists vx_admin.dns_records (
  id uuid primary key default gen_random_uuid(),
  zone_id text not null,
  record_name text not null,
  record_type text not null default 'A' check (record_type in ('A')),
  cloudflare_record_id text,
  proxied boolean not null default false,
  ttl integer not null default 1 check (ttl = 1 or ttl between 60 and 86400),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (zone_id, record_name, record_type)
);

alter table vx_admin.cloudflare_config enable row level security;
alter table vx_admin.dns_records enable row level security;

-- No policies are defined: access is restricted to trusted server-side roles.
-- Insert the config row and records using the Supabase SQL editor. IDs are generated automatically.
