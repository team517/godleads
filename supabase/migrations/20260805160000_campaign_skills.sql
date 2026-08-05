-- Owner-level "skills" (knowledge base) fed to the AI campaign generator.
alter table public.profiles add column if not exists campaign_skills text;

create or replace function public.set_campaign_skills(p_text text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  update public.profiles set campaign_skills = nullif(p_text, '') where user_id = auth.uid();
end;
$$;

grant execute on function public.set_campaign_skills(text) to authenticated;
