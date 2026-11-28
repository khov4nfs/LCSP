-- Why: A running preparation needs a committed stop intent before the API contacts Agent Server.
-- How: The nonterminal state survives API crashes and can be retried by the cancellation poller.
-- Invariant: CANCELLED is reserved for a confirmed native stop or a run that never dispatched.
ALTER TYPE "AgentExecutionState" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED';
