-- Recreate v_bills_aging with bucket labels matching the application code
-- ('current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'paid').
-- The previous labels ('1-30', '31-60', etc.) broke the bill-pay UI which
-- groups bills by these exact strings.

CREATE OR REPLACE VIEW public.v_bills_aging AS
SELECT
    id,
    tenant_id,
    vendor_id,
    invoice_id,
    bill_number,
    bill_date,
    due_date,
    amount,
    amount_paid,
    status,
    approval_status,
    approved_at,
    approved_by,
    location_id,
    notes,
    created_at,
    updated_at,
    amount - COALESCE(amount_paid, 0::numeric) AS balance,
    CURRENT_DATE - due_date AS days_overdue,
    CASE
        WHEN status = 'paid'::text THEN 'paid'::text
        WHEN (CURRENT_DATE - due_date) <= 0 THEN 'current'::text
        WHEN (CURRENT_DATE - due_date) <= 30 THEN 'd1_30'::text
        WHEN (CURRENT_DATE - due_date) <= 60 THEN 'd31_60'::text
        WHEN (CURRENT_DATE - due_date) <= 90 THEN 'd61_90'::text
        ELSE 'd90_plus'::text
    END AS aging_bucket
FROM public.bills b;
