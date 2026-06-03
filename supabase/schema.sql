create extension if not exists pgcrypto;

create table if not exists public.managers (
  id integer primary key,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.competencies (
  id integer primary key,
  title text not null,
  short_title text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.l360_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'manager')),
  manager_id integer references public.managers(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint manager_role_requires_manager check (
    (role = 'manager' and manager_id is not null)
    or (role = 'super_admin' and manager_id is null)
  )
);

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  manager_id integer not null references public.managers(id) on delete cascade,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.evaluation_scores (
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  competency_id integer not null references public.competencies(id) on delete cascade,
  score integer not null check (score between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (evaluation_id, competency_id)
);

insert into public.managers (id, display_name)
values
  (1, 'Топ-менеджер 1'),
  (2, 'Топ-менеджер 2'),
  (3, 'Топ-менеджер 3'),
  (4, 'Топ-менеджер 4'),
  (5, 'Топ-менеджер 5'),
  (6, 'Топ-менеджер 6'),
  (7, 'Топ-менеджер 7'),
  (8, 'Топ-менеджер 8'),
  (9, 'Топ-менеджер 9')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.competencies (id, title, short_title, description)
values
  (1, 'Принятие решений', 'Решения', 'Выбор курса действий в неопределенности и ответственность за последствия.'),
  (2, 'Стратегическое мышление', 'Стратегия', 'Видение рынка, долгосрочных рисков и точек роста за пределами операционки.'),
  (3, 'Управление людьми', 'Люди', 'Постановка целей, развитие лидеров, обратная связь и результативность команды.'),
  (4, 'Финансовая грамотность', 'Финансы', 'Понимание экономики решений, P&L, маржинальности, cash flow и окупаемости.'),
  (5, 'Коммуникация и влияние', 'Влияние', 'Ясное объяснение позиции, договоренности и проведение решений через группы.'),
  (6, 'Управление изменениями', 'Изменения', 'Проведение трансформаций от причины изменений до внедрения и закрепления.'),
  (7, 'Клиент и рынок', 'Клиент', 'Ориентация на клиента, конкурентную среду и реальную ценность продукта.'),
  (8, 'Операционная дисциплина', 'Операции', 'Перевод целей в процессы, метрики, регулярный контроль и предсказуемый результат.'),
  (9, 'Лидерская зрелость', 'Зрелость', 'Саморегуляция, этика, устойчивость под давлением и доверие команды.')
on conflict (id) do update set
  title = excluded.title,
  short_title = excluded.short_title,
  description = excluded.description;

alter table public.managers enable row level security;
alter table public.competencies enable row level security;
alter table public.l360_profiles enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_scores enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.l360_profiles where user_id = auth.uid()
$$;

create or replace function public.current_manager_id()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select manager_id from public.l360_profiles where user_id = auth.uid()
$$;

create or replace function public.submit_evaluation(
  p_manager_id integer,
  p_scores jsonb,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evaluation_id uuid;
  v_index integer;
  v_score integer;
  v_comment text;
begin
  if not exists (select 1 from public.managers where id = p_manager_id) then
    raise exception 'Unknown manager id';
  end if;

  if jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) <> 9 then
    raise exception 'Scores must be a JSON array with 9 values';
  end if;

  v_comment := nullif(left(trim(coalesce(p_comment, '')), 800), '');

  insert into public.evaluations (manager_id, comment)
  values (p_manager_id, v_comment)
  returning id into v_evaluation_id;

  for v_index in 0..8 loop
    v_score := (p_scores ->> v_index)::integer;
    if v_score < 0 or v_score > 5 then
      raise exception 'Score out of range';
    end if;

    insert into public.evaluation_scores (evaluation_id, competency_id, score)
    values (v_evaluation_id, v_index + 1, v_score);
  end loop;

  return v_evaluation_id;
end;
$$;

drop policy if exists "Public can read managers" on public.managers;
create policy "Public can read managers"
on public.managers for select
using (true);

drop policy if exists "Public can read competencies" on public.competencies;
create policy "Public can read competencies"
on public.competencies for select
using (true);

drop policy if exists "Users can read own profile" on public.l360_profiles;
create policy "Users can read own profile"
on public.l360_profiles for select
using (
  user_id = auth.uid()
  or public.current_user_role() = 'super_admin'
);

drop policy if exists "Admins and assigned managers can read evaluations" on public.evaluations;
create policy "Admins and assigned managers can read evaluations"
on public.evaluations for select
using (
  public.current_user_role() = 'super_admin'
  or manager_id = public.current_manager_id()
);

drop policy if exists "Admins and assigned managers can read scores" on public.evaluation_scores;
create policy "Admins and assigned managers can read scores"
on public.evaluation_scores for select
using (
  exists (
    select 1
    from public.evaluations e
    where e.id = evaluation_scores.evaluation_id
      and (
        public.current_user_role() = 'super_admin'
        or e.manager_id = public.current_manager_id()
      )
  )
);

grant usage on schema public to anon, authenticated;
grant select on public.managers to anon, authenticated;
grant select on public.competencies to anon, authenticated;
grant select on public.l360_profiles to authenticated;
grant select on public.evaluations to authenticated;
grant select on public.evaluation_scores to authenticated;
grant execute on function public.submit_evaluation(integer, jsonb, text) to anon, authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_manager_id() to authenticated;

-- After creating users in Supabase Auth, map them to roles here:
-- insert into public.l360_profiles (user_id, role, manager_id)
-- values
--   ('00000000-0000-0000-0000-000000000000', 'super_admin', null),
--   ('11111111-1111-1111-1111-111111111111', 'manager', 1);
