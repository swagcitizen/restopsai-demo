-- Force v_bar_inventory_status to honor the underlying inventory_items
-- RLS of the querying user. Without security_invoker, the view leaked
-- rows across tenants.

ALTER VIEW public.v_bar_inventory_status SET (security_invoker = on);
