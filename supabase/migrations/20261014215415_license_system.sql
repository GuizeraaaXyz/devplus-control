create schema if not exists private;

grant usage on schema public to service_role;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.licenses (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  key_hint text not null,
  plan text not null check (length(trim(plan)) between 1 and 80),
  duration_months smallint not null check (duration_months between 1 and 24),
  state text not null default 'issued' check (state in ('issued', 'active', 'revoked')),
  device_hash text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index licenses_created_at_idx on private.licenses (created_at desc);
create index licenses_state_expires_at_idx on private.licenses (state, expires_at);

alter table private.licenses enable row level security;
revoke all on table private.licenses from public, anon, authenticated;
grant select, insert, update on table private.licenses to service_role;

create table private.license_rate_limits (
  bucket text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  primary key (bucket, subject_hash)
);

alter table private.license_rate_limits enable row level security;
revoke all on table private.license_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table private.license_rate_limits to service_role;
create index license_rate_limits_window_idx
  on private.license_rate_limits (window_started_at);

create function private.license_view(p_license private.licenses)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'status', case
      when (p_license).state = 'issued' then 'inactive'
      when (p_license).state = 'revoked' then 'revoked'
      when (p_license).expires_at <= now() then 'expired'
      else 'active'
    end,
    'plan', (p_license).plan,
    'expiresAt', (p_license).expires_at,
    'device', jsonb_build_object(
      'used', case when (p_license).device_hash is null then 0 else 1 end,
      'limit', 1
    )
  ));
$$;

create function public.license_check_rate_limit(
  p_bucket text,
  p_subject_hash text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request_count integer;
begin
  if random() < 0.01 then
    delete from private.license_rate_limits
    where window_started_at <= now() - interval '1 day';
  end if;

  if p_bucket is null
    or p_bucket not in ('activate', 'status', 'admin')
    or p_max_requests < 1
    or p_window_seconds < 1
    or p_window_seconds > 3600
    or coalesce(length(p_subject_hash), 0) <> 64 then
    return false;
  end if;

  insert into private.license_rate_limits as limits (
    bucket, subject_hash, window_started_at, request_count
  ) values (
    p_bucket, p_subject_hash, now(), 1
  )
  on conflict (bucket, subject_hash) do update set
    window_started_at = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then 1
      else limits.request_count + 1
    end
  returning request_count into v_request_count;

  return v_request_count <= p_max_requests;
end;
$$;

create function public.license_activate(p_key_hash text, p_device_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_license private.licenses%rowtype;
begin
  if coalesce(length(p_key_hash), 0) <> 64
    or coalesce(length(p_device_hash), 0) <> 64 then
    return jsonb_build_object('error', 'INVALID_REQUEST');
  end if;

  select * into v_license
  from private.licenses
  where key_hash = p_key_hash
  for update;

  if not found then
    return jsonb_build_object('error', 'INVALID_LICENSE');
  end if;

  if v_license.state = 'issued' then
    update private.licenses
    set state = 'active',
        device_hash = p_device_hash,
        activated_at = now(),
        expires_at = now() + make_interval(months => v_license.duration_months)
    where id = v_license.id
    returning * into v_license;
  elsif v_license.state <> 'revoked' and v_license.device_hash is null then
    update private.licenses
    set device_hash = p_device_hash
    where id = v_license.id
    returning * into v_license;
  elsif v_license.device_hash is distinct from p_device_hash then
    return jsonb_build_object('error', 'DEVICE_LIMIT_REACHED');
  end if;

  return private.license_view(v_license);
end;
$$;

create function public.license_status(p_key_hash text, p_device_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_license private.licenses%rowtype;
begin
  if coalesce(length(p_key_hash), 0) <> 64
    or coalesce(length(p_device_hash), 0) <> 64 then
    return jsonb_build_object('error', 'INVALID_REQUEST');
  end if;

  select * into v_license
  from private.licenses
  where key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('error', 'INVALID_LICENSE');
  end if;

  if v_license.state <> 'issued'
    and v_license.device_hash is distinct from p_device_hash then
    return jsonb_build_object('error', 'DEVICE_LIMIT_REACHED');
  end if;

  return private.license_view(v_license);
end;
$$;

create function public.license_admin_create(
  p_key_hash text,
  p_key_hint text,
  p_plan text,
  p_duration_months integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_license private.licenses%rowtype;
begin
  if coalesce(length(p_key_hash), 0) <> 64
    or coalesce(length(p_key_hint), 0) <> 6
    or coalesce(length(trim(p_plan)), 0) not between 1 and 80
    or p_duration_months is null
    or p_duration_months not between 1 and 24 then
    return jsonb_build_object('error', 'INVALID_LICENSE_OPTIONS');
  end if;

  insert into private.licenses (key_hash, key_hint, plan, duration_months)
  values (p_key_hash, p_key_hint, trim(p_plan), p_duration_months)
  returning * into v_license;

  return jsonb_build_object(
    'id', v_license.id,
    'keyHint', v_license.key_hint,
    'plan', v_license.plan,
    'durationMonths', v_license.duration_months,
    'status', 'inactive',
    'createdAt', v_license.created_at
  );
end;
$$;

create function public.license_admin_list()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    private.license_view(licenses) || jsonb_build_object(
      'id', licenses.id,
      'keyHint', licenses.key_hint,
      'durationMonths', licenses.duration_months,
      'createdAt', licenses.created_at,
      'activatedAt', licenses.activated_at,
      'revokedAt', licenses.revoked_at
    )
    order by licenses.created_at desc
  ), '[]'::jsonb)
  from private.licenses as licenses;
$$;

create function public.license_admin_revoke(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_license private.licenses%rowtype;
begin
  update private.licenses
  set state = 'revoked', revoked_at = now()
  where id = p_id
  returning * into v_license;

  if not found then
    return jsonb_build_object('error', 'LICENSE_NOT_FOUND');
  end if;

  return private.license_view(v_license) || jsonb_build_object('id', v_license.id);
end;
$$;

create function public.license_admin_reset_device(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_license private.licenses%rowtype;
begin
  update private.licenses
  set device_hash = null
  where id = p_id and state <> 'revoked'
  returning * into v_license;

  if not found then
    if exists (select 1 from private.licenses where id = p_id) then
      return jsonb_build_object('error', 'LICENSE_REVOKED');
    end if;
    return jsonb_build_object('error', 'LICENSE_NOT_FOUND');
  end if;

  return private.license_view(v_license) || jsonb_build_object('id', v_license.id);
end;
$$;

create function public.license_admin_renew(p_id uuid, p_duration_months integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_license private.licenses%rowtype;
begin
  if p_duration_months is null or p_duration_months not between 1 and 24 then
    return jsonb_build_object('error', 'INVALID_LICENSE_OPTIONS');
  end if;

  select * into v_license
  from private.licenses
  where id = p_id
  for update;

  if not found then
    return jsonb_build_object('error', 'LICENSE_NOT_FOUND');
  end if;
  if v_license.state = 'revoked' then
    return jsonb_build_object('error', 'LICENSE_REVOKED');
  end if;

  if v_license.state = 'issued' then
    if v_license.duration_months + p_duration_months > 24 then
      return jsonb_build_object('error', 'INVALID_LICENSE_OPTIONS');
    end if;
    update private.licenses
    set duration_months = duration_months + p_duration_months
    where id = p_id
    returning * into v_license;
  else
    update private.licenses
    set expires_at = greatest(coalesce(expires_at, now()), now())
      + make_interval(months => p_duration_months)
    where id = p_id
    returning * into v_license;
  end if;

  return private.license_view(v_license) || jsonb_build_object('id', v_license.id);
end;
$$;

revoke all on function private.license_view(private.licenses) from public, anon, authenticated;
grant execute on function private.license_view(private.licenses) to service_role;

revoke all on function public.license_check_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.license_activate(text, text) from public, anon, authenticated;
revoke all on function public.license_status(text, text) from public, anon, authenticated;
revoke all on function public.license_admin_create(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.license_admin_list() from public, anon, authenticated;
revoke all on function public.license_admin_revoke(uuid) from public, anon, authenticated;
revoke all on function public.license_admin_reset_device(uuid) from public, anon, authenticated;
revoke all on function public.license_admin_renew(uuid, integer) from public, anon, authenticated;

grant execute on function public.license_check_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.license_activate(text, text) to service_role;
grant execute on function public.license_status(text, text) to service_role;
grant execute on function public.license_admin_create(text, text, text, integer) to service_role;
grant execute on function public.license_admin_list() to service_role;
grant execute on function public.license_admin_revoke(uuid) to service_role;
grant execute on function public.license_admin_reset_device(uuid) to service_role;
grant execute on function public.license_admin_renew(uuid, integer) to service_role;
