-- Stop finalize_inventory_count() from overwriting inventory_items.on_hand
-- with the count quantity. The bar inventory status view computes
-- days_of_supply from on_hand + 14d depletion, so mutating on_hand at
-- finalize time destroyed the canonical purchase-time snapshot the view
-- relies on. Variance is computed from count lines directly
-- (beginning + purchases - ending), so on_hand mutation is unnecessary.

CREATE OR REPLACE FUNCTION public.finalize_inventory_count(p_count_id uuid)
RETURNS public.inventory_counts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_loc uuid;
  v_row public.inventory_counts;
BEGIN
  SELECT tenant_id, location_id INTO v_tenant, v_loc
    FROM public.inventory_counts WHERE id = p_count_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Count % not found', p_count_id;
  END IF;
  IF NOT public.is_tenant_manager_or_owner(v_tenant) THEN
    RAISE EXCEPTION 'Not authorized to finalize counts for tenant %', v_tenant USING ERRCODE = '42501';
  END IF;

  -- NOTE: Finalizing a count does NOT mutate inventory_items.on_hand.
  -- The variance report computes actual usage from count lines directly
  -- (beginning + purchases - ending). Mutating on_hand here would lose
  -- the canonical purchase-time on_hand snapshot the bar inventory view relies on.

  UPDATE public.inventory_counts
     SET status = 'finalized', updated_at = now()
   WHERE id = p_count_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
