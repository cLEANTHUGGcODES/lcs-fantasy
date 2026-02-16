# Draft Room Audit Checklist

## P0 Edge-Case Correctness

### 1) Race Around Clock = 0

1. On-clock user clicks `Confirm draft` with <1s remaining.
2. Force server timeout first (or inject latency).
3. Verify:
   - Selection and confirm state clear.
   - UI shows explicit server-owned outcome (`Timed out -> Autopicked ...` or `Timed out -> Skipped`).
   - Timeline jumps/highlights the resolved pick.
   - Event emitted: `timeout.outcome`.

### 2) Reconnect While On Clock

1. Disconnect realtime while user is on clock.
2. Wait past deadline, then reconnect.
3. Verify:
   - Status banner reports timeout outcome after sync.
   - Draft actions remain read-only until subscribed.
   - Timeline highlights resolved pick.
   - Events emitted: `reconnect.start`, `reconnect.end`, `timeout.outcome`.

### 3) Selected Player Becomes Unavailable

1. Select a player in the board.
2. Draft same player from another session.
3. Verify:
   - Sticky action state clears selection/confirm state.
   - Notice reads `Player no longer available`.
   - Activity feed logs unavailability.
   - Events emitted: `selection.unavailable`.

### 4) Autopick Trust Parity

1. With queue populated, verify preview line includes:
   - queued/autopick target
   - server timeout fallback target when different
2. With queue empty, verify fallback copy uses server board order language (no projections wording).
3. Force timeout and verify resolved player matches fallback expectation.

## P1 Performance & UX

### 5) Timer Rerender Pressure

1. Start live draft and profile rerenders while on clock.
2. Verify:
   - no sub-second full-room rerender loop
   - player table remains stable on 1s timer cadence

### 6) Keyboard Confirm Ergonomics

1. Enter manual confirm state.
2. Verify:
   - `Enter` confirms
   - `Escape` cancels
   - slot impact line is visible and accurate

## P2 Observability

### 7) Event Coverage

Validate these events are emitted with useful payload:

1. `draft.confirmed` / `draft.failed`
2. `timeout.outcome`
3. `autopick.toggle` / `autopick.toggle_blocked` / `autopick.locked_state`
4. `reconnect.start` / `reconnect.end`
5. `selection.unavailable`
6. `latency.staleness_warning`
