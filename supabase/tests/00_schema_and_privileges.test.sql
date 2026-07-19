begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

select ok(
  (
    select bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  'critical public tables enable and force RLS'
);

select is(
  (select count(*)::integer
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relrowsecurity and c.relforcerowsecurity),
  33,
  'all public tenant tables were found with FORCE RLS'
);

select ok(not has_table_privilege('anon', 'public.customers', 'SELECT'), 'anon cannot read customers');
select ok(not has_table_privilege('authenticated', 'public.customers', 'SELECT'), 'authenticated base-table customer reads are API-only');
select ok(not has_table_privilege('authenticated', 'public.work_orders', 'SELECT'), 'authenticated base-table work order reads are API-only');
select ok(not has_table_privilege('authenticated', 'public.photos', 'INSERT'), 'authenticated cannot forge photo rows');
select ok(not has_table_privilege('authenticated', 'public.photos', 'UPDATE'), 'authenticated cannot finalize or rewrite photo rows');
select ok(not has_table_privilege('authenticated', 'public.public_access_tokens', 'INSERT'), 'authenticated cannot mint public tokens');
select ok(not has_table_privilege('authenticated', 'public.public_access_tokens', 'UPDATE'), 'authenticated cannot extend or rescope public tokens');
select ok(not has_table_privilege('authenticated', 'public.quotes', 'UPDATE'), 'authenticated cannot bypass quote transaction RPCs');
select ok(not has_table_privilege('authenticated', 'public.quote_versions', 'UPDATE'), 'authenticated cannot rewrite quote versions');
select ok(not has_table_privilege('authenticated', 'public.work_order_checklist_items', 'UPDATE'), 'authenticated checklist changes require the response RPC');
select ok(not has_table_privilege('authenticated', 'public.work_order_checklist_items', 'DELETE'), 'authenticated cannot delete checklist evidence requirements');
select ok(not has_table_privilege('authenticated', 'private.line_channel_credentials', 'SELECT'), 'authenticated cannot read LINE credentials');
select ok(has_function_privilege('authenticated', 'public.transition_work_order_safe(uuid,uuid,text,integer,timestamp with time zone,text,text,text,uuid,text)', 'EXECUTE'), 'authenticated can call the validated work-order transition wrapper');
select ok(not has_function_privilege('service_role', 'public.transition_work_order_safe(uuid,uuid,text,integer,timestamp with time zone,text,text,text,uuid,text)', 'EXECUTE'), 'request-path transition does not use service role');
select ok(not has_function_privilege('authenticated', 'public.transition_work_order(uuid,uuid,text,integer,timestamp with time zone,text,text,text,uuid,text)', 'EXECUTE'), 'raw work-order transition RPC is not exposed');

select * from finish();
rollback;
