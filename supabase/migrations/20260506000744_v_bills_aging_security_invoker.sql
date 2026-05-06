-- Force v_bills_aging to honor the underlying bills RLS policies of the
-- querying user instead of the view owner's privileges. Without
-- security_invoker, the view leaks rows across tenants.

ALTER VIEW public.v_bills_aging SET (security_invoker = on);
