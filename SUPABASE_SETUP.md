# Supabase Setup

## 1. Create or choose a Supabase project

Use an existing Supabase project or create a new one.

Required public values:

- Project URL
- anon/public key

Put them into `supabase-config.js`:

```js
window.L360_SUPABASE = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_ANON_OR_PUBLISHABLE_KEY"
};
```

Do not put a service role key in frontend files.

## 2. Create database schema

Open Supabase Dashboard -> SQL Editor and run:

```sql
-- paste contents of supabase/schema.sql
```

This creates:

- `managers`
- `competencies`
- `l360_profiles`
- `evaluations`
- `evaluation_scores`
- RLS policies
- `submit_evaluation(...)` RPC for anonymous public submissions

## 3. Create users

Create users in Supabase Dashboard -> Authentication -> Users.

Recommended:

- one super-admin user
- one user per top-manager

## 4. Map users to roles

After creating users, copy their user IDs and run SQL like this:

```sql
insert into public.l360_profiles (user_id, role, manager_id)
values
  ('SUPER_ADMIN_USER_ID', 'super_admin', null),
  ('MANAGER_1_USER_ID', 'manager', 1),
  ('MANAGER_2_USER_ID', 'manager', 2)
on conflict (user_id) do update set
  role = excluded.role,
  manager_id = excluded.manager_id;
```

Manager IDs are `1..9`.

## 5. Access rules

- Public visitors can submit anonymous evaluations through `submit_evaluation`.
- Super-admin users can read all evaluations, scores, and comments.
- Manager users can read only evaluations, scores, and comments for their own `manager_id`.

The static demo still falls back to `localStorage` while `supabase-config.js` is empty.
