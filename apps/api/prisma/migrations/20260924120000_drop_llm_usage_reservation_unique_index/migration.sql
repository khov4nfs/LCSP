-- LCSP-339: the original billing foundation migration created reservationId as
-- a standalone unique index. Later reservation-group support must remove that
-- index so one reservation can cover multiple provider attempts.
DROP INDEX IF EXISTS "LlmUsageEvent_reservationId_key";
