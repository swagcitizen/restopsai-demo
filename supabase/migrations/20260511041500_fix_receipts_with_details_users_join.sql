-- Fix: receipts_with_details view joined auth.users directly, which is not
-- readable by the authenticated role -> all SELECTs from the frontend got
-- 42501 permission denied for table users.
--
-- Replace the join with a SECURITY DEFINER helper that returns the user email
-- by id. The helper is restricted: it only returns emails for users that
-- share a tenant with the caller, so we don't leak unrelated users.

CREATE OR REPLACE FUNCTION public.user_email_for_tenant_member(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
DECLARE
  v_email text;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  -- Only return the email if the caller shares at least one tenant with
  -- the target user (or is the target user themselves).
  IF p_user_id = auth.uid() THEN
    SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
    RETURN v_email;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.memberships m1
    JOIN public.memberships m2 ON m2.tenant_id = m1.tenant_id
    WHERE m1.user_id = auth.uid()
      AND m2.user_id = p_user_id
  ) THEN
    SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
    RETURN v_email;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.user_email_for_tenant_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_email_for_tenant_member(uuid) TO authenticated;

-- Drop and recreate the view without the auth.users join.
DROP VIEW IF EXISTS public.receipts_with_details;

CREATE VIEW public.receipts_with_details
WITH (security_invoker = true)
AS
SELECT
  r.id,
  r.tenant_id,
  r.uploaded_by,
  r.uploaded_at,
  r.source,
  r.storage_path,
  r.file_name,
  r.file_size_bytes,
  r.mime_type,
  r.thumbnail_path,
  r.vendor_name,
  r.vendor_address,
  r.vendor_phone,
  r.receipt_date,
  r.total_amount,
  r.subtotal_amount,
  r.tax_amount,
  r.tip_amount,
  r.payment_method,
  r.payment_last4,
  r.currency,
  r.ocr_status,
  r.ocr_processed_at,
  r.ocr_error,
  r.ocr_confidence,
  r.ocr_raw_json,
  r.category,
  r.vendor_id,
  r.notes,
  r.tags,
  r.bill_id,
  r.bill_status,
  r.voided_at,
  r.void_reason,
  r.created_at,
  r.updated_at,
  (SELECT COUNT(*)::integer FROM public.receipt_line_items li WHERE li.receipt_id = r.id) AS line_item_count,
  public.user_email_for_tenant_member(r.uploaded_by) AS uploader_email
FROM public.receipts r;

GRANT SELECT ON public.receipts_with_details TO authenticated;
