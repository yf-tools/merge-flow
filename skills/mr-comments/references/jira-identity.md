# Step 3 — one authoritative Jira identity, and what its status means

Read this in batch 1, with the fetch. Step 3 runs before the report and its result is one row on it, so a separate turn spent reading this is a round trip wasted on a local file. SKILL.md says which cases stop the run; the reconciliation branches and the status classification are here.

**No writes happen in Step 3.** If you are about to change anything on the ticket, this is the wrong file — the transition is applied in Step 6 and the rest in Step 11.

## Step 3 — Verify the Jira Ticket (silent; no writes, no gate)

Read this at Step 3, alongside the stop conditions SKILL.md keeps resident.

## Reconcile one authoritative Jira identity

Use the evidence collected in Step 2 to resolve **exactly one `(Jira hostname, ticket key)` pair**:

- **Several keys or conflicting key sources** → 🛑 show each source and ask which ticket this MR belongs to. Do not choose the title or branch by precedence.
- **One key but several Jira browse-link hostnames** → 🛑 show every `(hostname, key)` candidate and ask which Jira site owns this MR. The same key can exist on more than one tenant.
- **One key and one browse-link hostname** → use that pair as the candidate.
- **One key and no hostname** → call `getAccessibleAtlassianResources`. One accessible site becomes the candidate; several require the user to choose. Never infer the site from the ticket prefix.

**The `cloudId` is the resource's `id`, or the host out of its `url` — never its `name`.** A site comes back as `{"id":"ed899348-b201-439b-88fe-dee7a34cd13c","url":"https://acme.atlassian.net","name":"acme"}`, and three of those four fields are wrong to pass. `name` is the tempting one and it fails every call with _"Failed to fetch cloud ID for: acme. Input does not look like a valid domain or URL"_. Observed on a real run: `getJiraIssue` and `getTransitionsForJiraIssue` both failed, then both were retried with the full hostname, costing two wasted calls in the batch whose whole point is to be two calls. Prefer the `id`: it is literally the cloud ID and needs no parsing.

- **No key** → 🛑 stop and ask for the Jira ticket. This workflow does not waive Jira verification; an MR without a Jira ticket needs a different/manual review workflow.

Call `getJiraIssue` for the selected pair with at least `summary`, `status`, `assignee`, `issuetype`, and `timetracking`. Compare its key and summary with the MR title/description. A 404, permission failure, different key, or summary that does not match the MR's work is a 🛑 stop for correction — never merely flag a mismatch and continue. Retain the verified `{cloudId}`, hostname, `{TICKET-KEY}`, original status, and browse URL through Step 11.

If Atlassian tools are unavailable, ask once — here, because you genuinely cannot proceed without it — for the exact Jira hostname, ticket key, summary, and current status. That is the identity check, and it is a hard stop. But the _transition_ still defers: fold "and move it to {status} when I start?" into Step 6 exactly as in the automated path, then give the manual instruction there. This is manual verification, not a synchronization waiver; do not claim Jira was checked or changed by the workflow.

## Why the transition question defers to Step 6

Verification and transition have opposite urgency:

- **Verification is urgent and free.** If the ticket doesn't exist, doesn't match the MR, or is already `Done`, everything downstream is wasted or wrong. Check it now, silently.
- **A transition is a write to shared team state, and it is never urgent.** Nothing between here and the first code edit needs the ticket to be active. `git checkout` is a local operation. Reading comments is a read. The board only needs to say "work is happening" from the moment work actually happens.

**So do not ask for a transition here.** Asking at this point costs the user a decision at the moment of _minimum_ context: 45 seconds into a run, before they have seen a single review comment, before they know the MR is even the one they meant, and before anyone knows whether there is any work to do at all. Measured on a real run: the transition question landed at 49 seconds, the user answered at 1m25s, and the triage report — the thing they actually asked for — did not appear until 5m48s. The one interruption in the whole first phase was for the least informative decision in it.

It is also frequently a write for nothing. A ticket bumped `To Do → In Progress` here, on an MR whose comments then all turn out to be already addressed, moved the board for a session that changed no code. Deferring costs nothing and avoids that entirely.

## Classifying the status

Use the exact `status.name` plus category; never treat `statusCategory.name === "In Progress"` as proof of the literal status. Jira's broad `indeterminate` category also contains review and blocked states.

**"Active-development-equivalent" is not a category you may assign.** A status counts as active development only if its exact `status.name` matches an active-development name, or the user confirmed that exact name is this project's active state. Observing `statusCategory.name === "In Progress"` on a `TO REVIEW` ticket and concluding "TO REVIEW is already active-development-equivalent here, so no transition is needed" is the exact failure this rule exists to stop — it silently converts a blocking gate into a no-op. If you catch yourself writing the words _equivalent_, _effectively active_, or _close enough_ about a status name, you owe the user a question, not a conclusion.

### 🛑 Stop here (rare, and continuing would be wrong)

- **Terminal/done** (`Done`, `Closed`, `Merged`, `Resolved`, `Rejected`) → stop. Ask whether this is the wrong ticket or whether it must be reopened through a separate, explicitly approved workflow. Never move completed work backwards because an MR still has comments.
- **Blocked, or a custom status you cannot classify** → stop. Show the exact status name and ask what it means for this work. Never clear a blocker or guess at a custom state's intent.

These stop immediately because they mean _the premise is wrong_ — either you have the wrong ticket, or someone has deliberately parked this work. Spending four minutes triaging comments first would waste that work, and the answer may well be "wrong MR."

### ➡️ Carry to Step 6 (the common case — say nothing now)

- **Active development** (`In Progress`, `In Development`, `Doing`, or the project's verified equivalent) → nothing to do, ever. No write, no question, and **no mention of it** — this is a check that passed, and per the output-discipline section those stay silent. Do not write "Jira is already In Progress ✓" as reassurance; it costs the user a line to read and tells them nothing they needed.
- **New/backlog** (`To Do`, `Backlog`, `Open`) → a transition to active development (`In Progress`) will be needed. Resolve the exact target now so Step 5/6 can name it, then move on quietly. This applies whether the MR proceeds down the review lane, has zero comments, or switches to conflict resolution.
- **Review state** (`To Review`, `In Review`, `Review`, or verified equivalent) → review feedback means implementation has resumed, so the same applies: resolve the exact target, stay quiet, ask in Step 6.

For both of the last two, do the read-only preparation now so the Step 6 question is concrete and needs no follow-up:

1. Call `getTransitionsForJiraIssue`. Find a transition whose exact `to.name` is a genuine active-development status. Never match on `to.statusCategory` alone.
2. **Record `{current status}`, `{exact target status}`, and `{transition name}`.** Step 6 needs all three to render a question the user can answer in one word.
3. **If no transition reaches an active-development status, that is not a licence to continue silently — but it is also not a reason to interrupt now.** Many real boards genuinely cannot go `TO REVIEW → In Progress`; one whose only outbound targets are `Merged`, `Blocked`, `Rejected`, `To Do` and a self-loop is entirely normal. Record the full reachable `to.name` set and carry _that_ to Step 6 instead, where it becomes the "no active transition available" form of the question. Do not resolve it by redefining the current status as active, and do not route through an intermediate status.

Nothing is written in this step. The transition itself happens in Step 7, after the user has approved it alongside the fixes.

Also record whether Step 11 should return the ticket to review. A move from `To Do` or `To Review` into active development normally means **yes**, but that final transition is a separate explicit approval in Step 8.
