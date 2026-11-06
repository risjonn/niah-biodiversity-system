-- Security fix F-12 (#30): plants_public is an updatable view that runs
-- as its owner, so RLS on plants does not apply through it. Supabase's
-- default grants gave anon and authenticated write access through it.
-- Visitors only need to read approved plants.
revoke all on public.plants_public from anon, authenticated;
grant select on public.plants_public to anon, authenticated;