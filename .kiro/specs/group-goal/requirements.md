# Group Goal Circle — Requirements

## Overview

The existing circle model rotates a pot to one member per cycle. This spec introduces a complementary circle type, `group_goal`, where all members contribute toward a shared savings target (e.g. a community project or group travel). The pot is released to a designated goal address only when the target is reached and members approve the release by simple-majority vote.

## Glossary

- **Group Goal Circle**: A circle whose contributions accumulate toward a shared `target_amount_usdc` instead of rotating to a single member.
- **Target Amount**: The shared savings goal, denominated in USDC (`target_amount_usdc`).
- **Goal Address**: The designated on-chain address that receives the pot on approved release.
- **Release Proposal**: An admin-initiated proposal to disburse the pot once the target is reached.
- **Simple Majority**: More than 50% of eligible member votes cast in favour.

## Requirements

### R1 — New circle type `group_goal`

- R1.1 The circle model SHALL support a `type` field with the value `group_goal` in addition to the existing rotating type.
- R1.2 A `group_goal` circle SHALL require a `target_amount_usdc` field (positive integer, smallest USDC unit).
- R1.3 A `group_goal` circle SHALL require a `goal_address` field identifying the disbursement destination.
- R1.4 Circle creation SHALL validate that `target_amount_usdc > 0` and that `goal_address` is a valid address.

### R2 — Contribution tracking

- R2.1 Contributions SHALL be tracked per member per cycle.
- R2.2 The accumulated pot SHALL equal the sum of all member contributions across all cycles.
- R2.3 Contributions SHALL continue to be accepted until the accumulated pot reaches `target_amount_usdc`.
- R2.4 Once the target is reached, further contributions SHALL be rejected (or flagged) until the release flow completes.
- R2.5 The circle page SHALL display a progress bar showing `accumulated / target_amount_usdc` as a percentage of the target reached.

### R3 — Release proposal and voting

- R3.1 When the target is reached, the circle admin SHALL be able to propose a release.
- R3.2 A release proposal SHALL record the proposer, the pot amount, the goal address, and a voting deadline.
- R3.3 Eligible members SHALL be able to vote yes or no on an open release proposal.
- R3.4 A release SHALL be approved when yes votes constitute a simple majority of votes cast.
- R3.5 A release proposal SHALL NOT be executable before the target is reached.

### R4 — Disbursement

- R4.1 On approved release, the full pot SHALL be transferred to the designated `goal_address`.
- R4.2 A rejected or expired proposal SHALL leave the pot intact and allow a new proposal.
- R4.3 Disbursement SHALL be idempotent: a completed release SHALL NOT be re-executed.

### R5 — Smart contract

- R5.1 The circle contract SHALL support the `group_goal` disbursement flow: accumulate contributions, gate on target, record proposal and votes, and disburse to `goal_address` on approval.
- R5.2 The contract SHALL emit events for contribution, proposal creation, vote, and disbursement.
- R5.3 The contract SHALL enforce simple-majority approval on-chain.

## Acceptance Criteria

- [ ] New circle type `group_goal` with a `target_amount_usdc` field
- [ ] Contributions tracked per member per cycle until the target is reached
- [ ] Target reached: admin proposes release; members vote (simple majority)
- [ ] Approved release: full pot transferred to the designated goal address
- [ ] Progress bar on the circle page shows % of target reached
- [ ] Smart contract updated to support the group goal disbursement flow
- [ ] Spec document created before implementation (`.kiro/specs/group-goal/`)
