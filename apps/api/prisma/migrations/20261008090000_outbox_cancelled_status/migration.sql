-- W6: terminal, non-replayable outbox status for retired V1 commands cancelled at quiescence.
-- Kept in its own migration so the new enum value is committed before any later migration references it.
ALTER TYPE "OutboxStatus" ADD VALUE 'CANCELLED';
