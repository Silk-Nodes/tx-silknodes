---
name: humanizer-silk
description: Strip AI writing tells out of drafts and write text that does not read as machine-generated, based on the Wikipedia WikiProject AI Cleanup "Signs of AI writing" field guide. Use this whenever you are writing or editing anything a human will read as the author's own words: blog posts, X threads, landing page copy, docs, README files, BD emails, launch announcements, changelogs, grant applications, or research writeups. Also use it when the user says a draft "sounds like AI", "sounds generic", "reads like slop", asks to humanize, de-slop, or de-GPT something, or asks you to audit text for AI tells. Trigger it proactively before returning any prose deliverable longer than a paragraph, even if the user did not mention AI writing.
---

# humanizer-silk

Source: Wikipedia:Signs of AI writing (WikiProject AI Cleanup), an observational catalog built from thousands of flagged articles. The full pattern catalog with examples lives in `references/patterns.md`. Read that file whenever you are running an audit or you need the specific phrasing lists. This file is the operating procedure.

## The one rule that governs the rest

No single tell proves anything. Humans use em dashes. Humans write in threes. The guide is explicit about this and it matters: a checklist applied mechanically produces text that is flattened rather than human. What identifies machine text is **density and co-occurrence**, several tells clustering in the same paragraph, plus the thing underneath all of them: assertions with no specific referent.

So the failure mode to avoid is not "used a banned word." It is "wrote three hundred words that could have been written by someone who had never touched the subject."

## Two modes

Figure out which one you are in before doing anything.

**Draft mode.** You are producing new text. Apply the constraints while writing, then run one audit pass on your own output before returning it. Do not narrate the pass.

**Audit mode.** The user hands you existing text. Do not rewrite unless asked. Produce the report format below, then offer the rewrite.

## Draft mode constraints

Write to these. They are ordered by how much they change the output.

1. **Every claim carries a referent.** A number, a name, a version, a date, a block height, an incident. "Validators need good monitoring" is machine text. "We page on missed blocks at 2 consecutive, not 5, because the Cosmos Hub jail threshold gives you about 90 minutes of slack and we want the second one" is not.
2. **Delete the significance layer.** If a sentence explains why the previous sentence matters, cut it. Facts carry their own weight. The tell is `-ing` tails: "improving reliability", "highlighting the shift", "underscoring the need for".
3. **Vary structure deliberately.** If two consecutive lists have three items, change one. If three consecutive sentences are the same length, break one to four words. Uniformity is the strongest structural tell and the easiest to fix.
4. **Never use "not X, it's Y".** Also "not only X but Y", "no X, no Y, just Z", and the two-sentence version where the second sentence starts with "However" and reverses the first. This is the single most recognizable construction in LLM output. If you want contrast, state the second thing and let it contrast on its own.
5. **Use "is".** LLMs avoid the copula: "serves as", "stands as", "functions as", "refers to", "represents". Say what the thing is.
6. **No section summaries.** No "In summary", "In conclusion", "Overall", "Ultimately". No closing paragraph that restates the piece. End on the last real thought. This one is load-bearing for the house voice.
7. **No challenges-then-optimism template.** The "Despite these challenges, the future looks promising" shape is a canned ending. If there are open problems, name them and stop.
8. **Attribute or drop.** "Studies show", "experts say", "many argue", "it is widely regarded" all mean you do not have a source. Name it or delete the claim.
9. **Punctuation.** No em dashes or en dashes (house rule, and independently the most-cited tell). Straight quotes and straight apostrophes, not curly. Sentence case in headings, not Title Case. No emoji in headings or as bullet markers.
10. **Formatting.** Prose by default. Do not convert an argument into bullets because bullets look organized. Never use the `**Bolded phrase**: sentence that restates the bolded phrase` bullet pattern, which is a ChatGPT signature. Bold rarely enough that each instance means something.

## Vocabulary

The word lists in `references/patterns.md` are frequency observations, not bans. Two guards:

- Do not swap a flagged word for a thesaurus synonym. That produces "fancy prose", a separate tell. Rewrite the sentence so the word is not needed.
- Domain terms keep their meaning. "Ecosystem", "validator set", "throughput", "finality", "liveness" are the correct technical words in this domain and should not be scrubbed. The tell is "vibrant ecosystem", not "ecosystem".

## Audit mode output

Do not produce a graded essay. Produce this:

```
density: N flags / M words  (N per 100)
verdict: clean | patchy | rewrite

flags:
[category] "exact quoted phrase"
  -> suggested fix or "cut"
```

Group flags by category, order by count descending. Quote the actual text so the user can find it. Skip categories with zero hits.

Density is a rough heuristic on the flags you found, not a score with any authority:
- under 1 per 100 words: clean, leave it alone
- 1 to 3 per 100: patchy, spot-fix the clusters
- over 3 per 100: rewrite, the fixes will not stick individually

Then say which single change would move the piece most. One, not a list.

## What not to do

The most common failure when applying this skill is overcorrection. Guard against these:

- **Do not strip voice.** If the writer uses a construction habitually and it reads as theirs, it stays. A tell in a stranger's text is a style in the author's.
- **Do not flatten technical precision** into casualness. Short and blunt is not the same as vague. "The relayer stalled on a packet timeout at height 19,204,881" beats "relaying broke" every time.
- **Do not add filler hedges** to sound human. "I think", "kind of", "honestly" scattered through a draft reads as performed informality, which is its own tell now.
- **Do not fabricate specifics** to satisfy constraint 1. If you do not have the number, say the claim is directional or ask the user for the figure. Inventing a block height to sound credible is worse than any writing tell in this document.
- **Do not run this on the user's own writing uninvited.** Audit mode is on request.

## Voice layer for Silk Nodes work

When the deliverable is Silk Nodes content, stack these on top:

- lowercase, direct, operator voice
- write from what was actually run and observed, not from what is true in general
- no wrap-up line, no call to action tacked on the end, no "what this means for you"
- specific chains, specific versions, specific failures
- a post can end mid-thought if the thought is finished

## Worked examples

**Input:** Our infrastructure serves as a testament to reliability, playing a vital role in securing the network while delivering seamless performance across a wide range of chains.
**Output:** zero slashing since 2021, across 20+ chains.

**Input:** It's not just about uptime. It's about trust.
**Output:** uptime is the part you can measure. the rest is whether someone answers at 3am.

**Input:** The upgrade introduced several improvements, enhancing throughput, reducing latency, and improving overall user experience.
**Output:** the upgrade cut p99 latency from 840ms to 210ms. throughput was unchanged.

**Input:** Despite these challenges, the future of parallel execution remains promising, with continued innovation expected to drive adoption.
**Output:** the scheduler still serializes on hot state. that is the open problem.
