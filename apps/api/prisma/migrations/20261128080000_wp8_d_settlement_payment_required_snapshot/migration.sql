-- Why: A last settled model call can deplete the shared wallet without a later admission request.
-- How: Persist the server's post-debit payment decision on the immutable usage receipt.
-- Invariant: Existing OFF/SHADOW receipts never represented a live debit and remain false.
ALTER TABLE "ModelUsageReceipt"
ADD COLUMN "paymentRequired" BOOLEAN NOT NULL DEFAULT false;
