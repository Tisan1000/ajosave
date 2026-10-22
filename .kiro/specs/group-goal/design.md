# Group Goal Circle — Design Spec

Issue: #303 — Product: group savings goal — circle with a shared savings target

## 1. Overview

The existing circle model rotates a pot to one member per cycle. This spec adds a
complementary circle type, `group_goal`, where every member contributes toward a
single shared target. The accumulated pot is released to a designated goal address
only after the target is reached and members approve the release by simple majority.

## 2. Data Model

### 2.1 Circle type

Extend the circle type union with `group_goal`:

```ts
type CircleType = 'rotating' | 'group_goal';
```

A `group_goal` circle carries the following additional fields:

| Field                | Type     | Description                                              |
| -------------------- | -------- | -------------------------------------------------------- |
| `target_amount_usdc` | `number` | Shared savings target in USDC (base units, 6 decimals).  |
| `goal_address`       | `string` | Designated recipient of the pot on approved release.     |
| `status`             | `enum`   | `saving` \| `release_proposed` \| `released`.            |

`target_amount_usdc` is required when `type === 'group_goal'` and must be > 0.

### 2.2 Contributions

Contributions are tracked per member per cycle, mirroring the rotating model:

```ts
type GroupGoalContribution = {
  circle_id: string;
  member_address: string;
  cycle: number;
  amount_usdc: number;
  tx_signature: string;
  created_at: string;
};
```

`total_contributed_usdc` for a circle is the sum of all contributions across all
members and cycles. Progress toward the target is:

```
progress = min(total_contributed_usdc / target_amount_usdc, 1)
```

### 2.3 Release proposal & votes

```ts
type ReleaseProposal = {
  circle_id: string;
  proposed_by: string;      // admin
  created_at: string;
  votes_for: string[];      // member addresses
  votes_against: string[];  // member addresses
  executed: boolean;
};
```

## 3. Flow

1. **Saving** — members contribute each cycle. Contributions accumulate until
   `total_contributed_usdc >= target_amount_usdc`.
2. **Proposal** — once the target is reached, the circle admin may propose a
   release. The proposal records the admin and opens voting.
3. **Voting** — each member casts one vote (for/against). Approval requires a
   simple majority of votes cast: `votes_for > votes_against`.
4. **Release** — on approval, the full pot is transferred to `goal_address` and
   the circle status becomes `released`. The proposal is marked `executed`.

Guards:
- A release cannot be proposed before the target is reached.
- Only the admin may propose a release.
- A member may vote at most once per proposal.
- A released circle accepts no further contributions or proposals.

## 4. Smart Contract Changes

Add to the circle program:

- `initialize_group_goal(target_amount_usdc, goal_address)` — creates a
  `group_goal` circle account with the target and goal address.
- `contribute(amount_usdc)` — transfers member USDC into the circle vault and
  records the contribution; rejected once `status === 'released'`.
- `propose_release()` — admin-only; requires `total_contributed_usdc >=
  target_amount_usdc`; sets `status = 'release_proposed'`.
- `vote_release(approve: bool)` — records a member vote; one vote per member.
- `execute_release()` — requires simple majority; transfers the full vault
  balance to `goal_address`; sets `status = 'released'`.

The vault is a program-derived account owned by the circle; disbursement uses a
signed CPI to the SPL token program.

## 5. UI

- Circle page shows a progress bar: `% of target reached` derived from
  `total_contributed_usdc / target_amount_usdc`.
- When the target is reached, the admin sees a "Propose release" action.
- Members see vote controls while a proposal is open, with live tallies.
- After release, the page shows the released state and the goal address.

## 6. Out of Scope

- Rotating-circle behavior is unchanged.
- No changes to currency display preferences beyond reusing existing helpers.
