# Group Goal Circle — Tasks

Issue: #303 — Product: group savings goal — circle with a shared savings target

## 1. Data model & types
- [ ] 1.1 Add `group_goal` to the `CircleType` union in `src/types/circle.ts`
- [ ] 1.2 Add optional `target_amount_usdc: number` to the `Circle` type (required when `type === 'group_goal'`)
- [ ] 1.3 Add optional `goal_address: string` to the `Circle` type (designated release destination)
- [ ] 1.4 Add `GroupGoalProgress` type: `{ circleId, targetAmountUsdc, totalContributedUsdc, percentReached, perMember: Record<string, number> }`

## 2. Contribution tracking
- [ ] 2.1 Extend contribution records with `cycleId` so contributions are tracked per member per cycle
- [ ] 2.2 Add `getGroupGoalProgress(circleId)` helper that sums contributions across cycles and computes `percentReached`
- [ ] 2.3 Guard: contributions accepted only while `totalContributedUsdc < targetAmountUsdc`
- [ ] 2.4 Emit a `target_reached` event/state when `totalContributedUsdc >= targetAmountUsdc`

## 3. Release proposal & voting
- [ ] 3.1 Add `ReleaseProposal` type: `{ id, circleId, proposedBy, goalAddress, createdAt, status: 'pending' | 'approved' | 'rejected', votes: Record<string, 'yes' | 'no'> }`
- [ ] 3.2 Admin-only action `proposeRelease(circleId)` — allowed only when target is reached
- [ ] 3.3 Member action `voteOnRelease(proposalId, vote)` — one vote per member, immutable once cast
- [ ] 3.4 Tally: simple majority of cast votes (`yes > no`) approves; ties reject
- [ ] 3.5 On approval, mark proposal `approved` and trigger disbursement

## 4. Disbursement
- [ ] 4.1 On approved release, transfer the full pot to `goalAddress`
- [ ] 4.2 Record disbursement transaction reference on the circle
- [ ] 4.3 Mark circle `completed` after successful transfer

## 5. Smart contract
- [ ] 5.1 Add `group_goal` circle kind with `target_amount` and `goal_address` storage
- [ ] 5.2 `contribute()` accumulates toward target; reject when target met
- [ ] 5.3 `propose_release()` restricted to admin, requires target reached
- [ ] 5.4 `vote_release()` one vote per member; `execute_release()` transfers full pot on simple majority
- [ ] 5.5 Tests: target tracking, majority approval, tie rejection, unauthorized propose/vote

## 6. UI
- [ ] 6.1 Progress bar on the circle page showing `% of target reached`
- [ ] 6.2 Per-member contribution breakdown for the current cycle
- [ ] 6.3 Admin "Propose release" button (enabled only when target reached)
- [ ] 6.4 Voting panel for members with yes/no and live tally
- [ ] 6.5 Completed state showing disbursement to goal address

## 7. Docs
- [ ] 7.1 `requirements.md` — user stories and acceptance criteria
- [ ] 7.2 `design.md` — data model, voting rules, contract flow
- [ ] 7.3 This `tasks.md` kept in sync as work lands
