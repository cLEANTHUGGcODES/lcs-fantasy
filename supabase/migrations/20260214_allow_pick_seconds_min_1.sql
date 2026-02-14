-- Allow 1-second draft pick timers for QA/bug testing.
ALTER TABLE public.fantasy_drafts
  DROP CONSTRAINT IF EXISTS fantasy_drafts_pick_seconds_check;

ALTER TABLE public.fantasy_drafts
  ADD CONSTRAINT fantasy_drafts_pick_seconds_check
  CHECK (pick_seconds >= 1 AND pick_seconds <= 900);
