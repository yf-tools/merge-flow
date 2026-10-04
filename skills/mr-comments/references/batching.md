# Why the batch plan is shaped the way it is

SKILL.md's "Four batches, not fifteen turns" carries the plan: what goes in each batch, the exact commands, and the rules about what never travels through you. **That plan is authoritative and complete — you can execute the whole first phase without this file.**

What lives here is the evidence. Every rule in that plan cost a real run something measurable, and the numbers are here so nobody has to re-derive them by making the same mistake again.

Read this when the plan looks wrong for the situation in front of you and you are about to deviate from it, when a batch comes back with something you don't recognise, or when a user asks why the workflow batches at all.

## The cost of serial calls

**MR !500: fifteen round trips, five minutes.** The MR fetch, the discussions fetch and every git read each returned in well under a second. The first phase still took five minutes, because roughly fifteen calls went out one per turn.

That is the whole case for batching. A round trip costs seconds of wall clock whether it reads a 40-line lockfile or an entire MR, so the per-call latency dominates everything else, and the only lever is how many turns you spend. The steps are numbered by dependency, but most of them don't actually depend on each other — which is why independence decides what goes together rather than step number.

**A batch that comes back with a surprise is re-issued as its own call.** Recovering one call is cheap. Issuing all of them serially to avoid the possibility is what costs the four minutes.

## Hunting for the script paths

**Three runs have now spent between two and nine calls confirming a path they were handed.** `locate_bundled_scripts`' own description states both absolute commands for the install verbatim, and it arrives with the tool list before SKILL.md is read. The paths are computed by the server from its own location, so they are not a convention that needs verifying.

Calling the tool costs about 15 seconds of first-use server start, on the critical path to the report. It is for a non-standard install where a path genuinely failed, not for reassurance.

## `--instance`, and why it isn't `--host`

Agent shells screen commands for long-running processes. `node … --host <h>` reads as a dev server: the check fires with *"appears to start a server (contains port or host)"*, and the fetch either dies or needs a safety-gate override to get through. **A real run took the override.**

The flag rejects unknown names as a hard error rather than falling back to a default, and that is deliberate: a dropped host argument returns a real MR from the wrong GitLab, which is worse than a failed command.

## Why the script triages before it prints

One call against two REST calls, and the fetch cannot come back short, because field selection sets the size instead of trimming whatever arrived.

It gathers `workspace_remote` and `current_user` itself, so the two checks that used to land in `undetermined` when a caller forgot to pass them now can't.

**`discussions` is deliberately trimmed, and `omitted` says how.** System-only threads and system notes are dropped, resolved threads keep a 160-character excerpt instead of a full body, and `position` is hoisted to the thread. Unresolved threads keep every body whole, because those are the only ones Step 5 quotes.

**That took a real MR's payload from 41,752 bytes to 12,798.** The full version overran the tool-result limit, and the run responded by writing it to a file, reading it twice and deleting it: five extra calls, about 45 seconds. When an MR has extensive discussions that risk stdout buffer limits, pass `--out .git/mr-{iid}.json`: the script writes the full payload inside `.git/` (which Git ignores and hides from your working tree) and returns a compact summary to stdout, preventing buffer truncation and keeping git status clean.

## Why the git reads are a script

`git status --porcelain` prints *nothing* on a clean tree, so in concatenated output an empty section is indistinguishable from a mangled separator. JSON makes empty structurally empty instead of conventionally empty, which is the entire reason `dirty` is a real boolean.

**The run this comes from:** it issued `git remote get-url origin; git branch --show-current; git status --porcelain`, could not tell the empty status apart from a broken separator, re-issued `git status --porcelain` alone to find out, then ran the script anyway. Three calls and nineteen seconds for the one thing the script returns in one.

Same run made a separate `git remote get-url origin` call and then got the same value from the script four seconds later.

## The `cloudId` that looks like a name

A site returns `{"id":"ed899348-…","url":"https://acme.atlassian.net","name":"acme"}`. Passing `acme` fails both Jira reads with *"Input does not look like a valid domain or URL"*. Observed on a real run, which burned two calls and a retry on it.

## Why `reporting.md` is read in batch 1 and not later

**A run that skipped it improvised a report** with no title heading, no `{needsYou} of {feedbackThreads}` lead, a paraphrased `countLine`, no classification marker, a "Suggested fix" the template forbids before the code is read, and no closing list — so the Jira question went back to being a second message.

Reading it in batch 1 is free: it depends on nothing, and the report is two turns away. A separate turn spent reading a local file is a round trip bought for nothing.

## Why `discussions_text` is passed through unchanged

**Rebuilding the payload as objects is how `resolvable` got dropped on a real run.** It then reported 0 resolvable threads on an MR with 11, and nothing errored, because a missing field reads as `undefined` rather than as a mistake.

Same reasoning behind never trimming a payload to make a call succeed: a failure on a large argument is about the argument, not its contents.

## Why a hand tally is not a cross-check

Invariant 1 is satisfied *by* the tool call. A number you counted yourself, sitting beside the tool's, is a second unsourced number — so when the two disagree there is nothing to arbitrate between them, and when they agree it proved nothing.

## The payload boundary

Both scripts and all four modules run on the same machine, in the same package. Anything you re-emit as a tool argument is generated token by token, so **a 10 KB argument costs more than the API call that produced it.**

One observed run had a payload arrive as a string and then started trimming note fields to "fix the size", which is how `resolvable` disappears.

Noticing that you are about to retype a payload is the signal that the work belongs on the other side of that boundary. That is how batch 1's triage ended up inside the script rather than in a tool call.
