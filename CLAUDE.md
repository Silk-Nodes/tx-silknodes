# tx.silknodes.io

Community analytics dashboard for the TX chain (formerly Coreum). Denom `ucore`,
address prefixes `core1` / `corevaloper1`. Built and run by Silk Nodes.

## writing

Any prose deliverable (posts, threads, docs, READMEs, landing copy, BD emails,
changelogs) goes through the `humanizer-silk` skill before it is returned. Read
`.claude/skills/humanizer-silk/SKILL.md` for the procedure and
`references/patterns.md` for the catalog.

This covers UI strings too, not only long-form. Empty states, tooltips, error
messages and card subtitles are where generated-sounding copy actually reaches
readers on this site.

Non-negotiables that apply without the skill loading:

- no em dashes, no en dashes, anywhere
- straight quotes and apostrophes, never curly
- sentence case headings
- no "in summary", "in conclusion", "overall", no closing restatement paragraph
- no "not X, it's Y" or "not only X but Y"
- no trailing `-ing` analysis clauses ("...improving reliability", "...highlighting the shift")
- no "studies show" or "experts say" without a name attached
- use "is", not "serves as" or "represents"
- lowercase, direct, operator voice for Silk Nodes content
- end on the last real thought, no wrap-up line, no tacked-on CTA

Every claim needs a referent: a number, a version, a chain, a date, an incident.
If the number is not known, say the claim is directional or ask. Never invent a
specific to sound credible.

Do not overcorrect: keep technical precision, keep domain terms (ecosystem,
finality, liveness are correct words), do not sprinkle "honestly" and "kind of"
to perform informality.

### two rules specific to this repo

No emoji anywhere in the product UI. Emoji are fine in social copy and in X
posts, never in the dashboard itself.

Numbers in user-facing copy must be traceable to a query, an endpoint or a
file in this repo. The governance participation figures were wrong in public
for months because they were taken from an indexer that silently dropped
votes, so "it came from our own API" is not sufficient on its own.
