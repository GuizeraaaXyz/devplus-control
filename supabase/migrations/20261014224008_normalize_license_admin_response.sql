create or replace function public.license_admin_list()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(
      private.license_view(licenses) || jsonb_build_object(
        'id', licenses.id,
        'keyHint', licenses.key_hint,
        'durationMonths', licenses.duration_months,
        'createdAt', licenses.created_at,
        'activatedAt', licenses.activated_at,
        'revokedAt', licenses.revoked_at
      )
    )
    order by licenses.created_at desc
  ), '[]'::jsonb)
  from private.licenses as licenses;
$$;
