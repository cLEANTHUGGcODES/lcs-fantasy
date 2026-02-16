create index if not exists fantasy_draft_team_pool_draft_role_projection_idx
  on public.fantasy_draft_team_pool (draft_id, player_role, projected_avg_fantasy_points desc, team_name);

create index if not exists fantasy_draft_picks_draft_participant_idx
  on public.fantasy_draft_picks (draft_id, participant_user_id);

create index if not exists fantasy_draft_picks_draft_participant_role_idx
  on public.fantasy_draft_picks (draft_id, participant_user_id, upper(btrim(coalesce(player_role, ''))));
