-- Expand the invoices.status CHECK constraint to allow the full set of
-- statuses the AP receiving + variance flow uses. The previous constraint
-- omitted 'received', causing the variance test to fail when marking a
-- delivery as received.

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'reviewed'::text,
    'posted'::text,
    'received'::text,
    'approved'::text,
    'paid'::text,
    'void'::text
  ]));
