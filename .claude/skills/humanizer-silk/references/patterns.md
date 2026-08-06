# pattern catalog

Derived from Wikipedia:Signs of AI writing (WikiProject AI Cleanup) plus the secondary coverage of it. The guide is descriptive, not prescriptive: it records what LLM output does more often than human writing of the same genre. Nothing here is a ban.

Contents:
1. Tone and framing
2. Sentence-level constructions
3. Vocabulary
4. Structure
5. Punctuation and typography
6. Formatting
7. Conversational leakage
8. Sourcing failures
9. Crypto and infra specific tells
10. Counter-signals (what human text has that machine text lacks)
11. Weak signals, do not act on alone

---

## 1. Tone and framing

**Significance inflation / puffery.** Everything is important, pivotal, or historic. Canonical phrases: "stands as a testament to", "plays a vital role", "plays a significant role", "marking a pivotal moment", "watershed moment", "enduring legacy", "rich cultural heritage", "leaves a lasting impact", "continues to captivate", "a key turning point".
Fix: state the fact. If it is significant, the reader will see it.

**Promotional drift.** Neutral subject described in brochure language: "breathtaking", "nestled in the heart of", "boasts", "vibrant", "must-see", "state-of-the-art", "cutting-edge".
Fix: replace the adjective with the measurement it is standing in for.

**Editorializing about what matters.** "It's important to note that", "it is worth remembering", "no discussion would be complete without", "notably", "importantly".
Fix: cut the frame, keep the sentence.

**Superficial tacked-on analysis.** A plain fact followed by a participial clause that pretends to interpret it. "...improving convenience." "...highlighting the growing demand." "...underscoring its influence." "...reflecting a broader shift."
This is one of the highest-frequency tells in the guide. It shows up as a trailing `-ing` phrase after a comma.
Fix: delete everything after the comma.

---

## 2. Sentence-level constructions

**Negative parallelism / contrast reframe.** The most recognizable single construction.
- "It's not X, it's Y"
- "It's not just X, it's Y"
- "Not only X, but also Y"
- "no X, no Y, just Z"
- reversed form (common in Grok output): "Y, not merely X"
- two-sentence form: statement, then a second sentence beginning "However," that reverses it
Fix: drop the negated half. Say the thing you actually mean.

**Rule of three.** Triplet adjectives ("innovative, transformative, and groundbreaking"), triplet phrases, and lists that are always exactly three items. Single instances are normal human writing. The tell is when every list in a piece has three items.
Fix: make it two or four wherever the content allows, or collapse to one strong word.

**False range.** Sounds specific, says nothing: "ranges from strategic planning to implementation support", "everything from X to Y".
Fix: name the actual items, or cut.

**Vague attribution.** "Studies show", "experts say", "observers have noted", "critics argue", "it is widely regarded as", "many believe".
Fix: name the source or delete the claim. In technical writing this is usually a signal that the claim was generated rather than known.

**Copula avoidance.** LLMs route around "is": "serves as", "stands as", "functions as", "acts as", "represents", "is characterized by". In lead sentences: "X refers to..." as if the article were about the word rather than the thing.
Fix: "X is Y."

**Conjunction stacking.** "Moreover", "Furthermore", "Additionally", "In addition", "On the other hand", "That said" appearing at the head of consecutive paragraphs. Produces essay tone.
Fix: most can be deleted with no loss. Keep at most one per piece.

**Adjective pairing.** "Adjective and adjective noun" and "adjective, adjective noun" as a reflex: "robust and scalable architecture", "clear, actionable insights".
Fix: pick one adjective, or none.

---

## 3. Vocabulary

High-frequency LLM words. Presence is not proof; density is the signal. Roughly ranked by how strongly they flag:

delve, tapestry, testament, underscore(s), pivotal, multifaceted, nuanced, embark, realm, crucial, foster, leverage, harness, navigate (figurative), unlock, showcase, boasts, intricate, comprehensive, robust, seamless, landscape (figurative), transformative, groundbreaking, game-changer, paradigm shift, holistic, myriad, plethora, elevate, empower, streamline, resonate, curated, bespoke, meticulous, vibrant, dynamic (as filler), ever-evolving, rapidly evolving, in today's fast-paced

Two guards:
- Do not thesaurus-swap. Replacing "leverage" with "utilize" makes it worse. Rewrite so the word is unnecessary: "use" or, better, name the specific action.
- Domain terms are not tells. In infra writing, "ecosystem", "throughput", "finality", "liveness", "orchestration" are the precise words. "Vibrant ecosystem" is the tell. "Cosmos ecosystem" is just correct.

---

## 4. Structure

**Section summaries.** "In summary", "In conclusion", "Overall", "To summarize", "Ultimately", followed by a restatement of what was just said. Also mid-piece: closing each section with a sentence that recaps the section.
Fix: delete. The reader read it.

**Challenges-and-future-prospects template.** A "Challenges" section starting with "Despite" that ends on an optimistic pivot: "Despite these challenges, the future remains promising." Also the sweeping abstract close: "the human condition", "the resilience of the human spirit", "as the industry continues to evolve".
Fix: name the open problems, end there.

**Symmetry.** Every section the same length. Every paragraph three sentences. Every heading the same grammatical shape. Human drafts are lumpy: one section runs long because the writer knew more about it.
Fix: let the section you actually know most about run longer.

**Vague "see also" / related links.** Loosely related items appended without a reason for being there.

---

## 5. Punctuation and typography

**Em dash usage.** LLMs use em dashes more often than nonprofessional human writing of the same genre, and use them where a human would use a comma, colon, or parentheses. They also tend to space them ( — ) against typographic convention. The guide is careful that this is not proof on its own, and says it is most useful combined with other signs.
House rule here: no em dashes, no en dashes, at all. Use commas, colons, parentheses.

**Curly quotes and apostrophes.** ChatGPT and DeepSeek default to typographic quotes and apostrophes, often mixed inconsistently with straight ones inside the same output. Mixed usage in one document is a stronger signal than consistent usage.
Fix: straight quotes and straight apostrophes throughout, or consistent curly if the platform demands it.

**Title Case headings.** Capitalizing every major word, where the surrounding convention is sentence case.

**Emoji in headings or as bullet markers.** Rarer in current models but still appears.

---

## 6. Formatting

**Bold lead-in bullets.** `**Term**: sentence that restates the term.` A ChatGPT signature that barely exists in unassisted writing. The bolded phrase is usually just reworded in the sentence after it.

**Bold overuse.** Product names, key terms, and phrases bolded mechanically rather than editorially.

**Lists in place of prose.** An argument that has been chopped into bullets loses the connective reasoning that made it an argument. LLMs default to lists because they look organized.
Fix: if the items have a causal or sequential relationship, write it as prose.

**Unnecessary small tables.** Two-column, three-row tables of things that were fine as a sentence.

**Markdown artifacts in the wrong medium.** Asterisks and underscores left in a context that does not render markdown, leftover `turn0search0` style link placeholders, and unfilled template slots like `[Insert your company name]` or `[Year]`.

---

## 7. Conversational leakage

Text meant for a chat window pasted into a document:
- "Certainly!", "Great question!", "Sure, here's..."
- "I hope this helps", "Let me know if you'd like me to expand"
- "As an AI language model", "I don't have access to", refusal fragments
- knowledge-cutoff disclaimers: "as of my last update", "as of my knowledge cutoff"
- the RAG variant: "this information does not appear to be publicly available", often paired with speculation about what it "likely" is
- letter register in non-letter content: "I hope this message finds you well" inside a blog post

Any one of these is close to conclusive on its own, unlike everything else in this file.

---

## 8. Sourcing failures

The deepest problem in the guide, and the reason WikiProject AI Cleanup exists:
- citations to sources that exist but do not contain the claim
- fabricated URLs returning 404 and absent from the Internet Archive
- invalid DOIs, ISBNs that fail checksum
- references formatted plausibly with wrong authors, wrong years, wrong journals
- a sudden cluster of dead external links added in one edit

For technical writing: the equivalent is a config flag, CLI argument, endpoint, or version number that reads plausibly and does not exist. Verify every one you did not personally run.

---

## 9. Crypto and infra specific tells

The generic catalog misses the ones that show up in this domain.

**Token-shill register.** "revolutionizing DeFi", "the future of finance", "democratizing access to", "unlocking new possibilities for web3", "poised for explosive growth". Reads as generated even when a human wrote it.
Fix: name the mechanism, not the promise.

**The trustless tricolon.** "trustless, permissionless, and decentralized" or "fast, secure, and scalable". Rule of three plus vocabulary tells in one phrase. Almost never survives contact with a real spec.
Fix: pick the property that is actually load-bearing for the point.

**Unfalsifiable performance claims.** "high throughput", "near-instant finality", "significantly lower fees", "enterprise-grade reliability". Numbers exist for all of these.
Fix: state the measured figure with the conditions it was measured under, or say you have not measured it.

**Fabricated technical specifics.** The domain equivalent of hallucinated citations, and the most damaging failure here:
- TPS figures, block times, and finality numbers stated confidently and wrong
- CLI flags, config keys, and env vars that read plausibly and do not exist
- RPC method names, endpoint paths, and module names invented by pattern
- governance proposal numbers, upgrade heights, and version tags that do not match the chain
- APRs, TVL, and commission rates carried over from a similar project
Verify every one against the actual repo, docs, or explorer. If you cannot verify, mark it as needing a check rather than shipping it.

**Neutrality theater on risk.** "As with any investment, do your own research" and "while promising, risks remain" are canned hedges that read as generated and provide no information.
Fix: name the specific risk. Slashing conditions, unbonding period, oracle dependency, upgrade coordination, a single sequencer.

**Ecosystem flattery.** Announcement replies that praise a team in generic terms: "incredible work from the team", "excited to see what comes next", "bullish on this". These are the reply-guy equivalent of AI slop.
Fix: react to the specific thing shipped, or say nothing.

**Audience mismatch.** Infra detail written for developers when the reader is an end user, or the reverse. Not an AI tell as such, but it produces the same generic-sounding output because the writer is aiming at nobody.

---

## 10. Counter-signals

What to add, not just what to remove. Human text tends to carry:
- specific numbers with units and dates
- named sources, named people, named versions
- variance in sentence length, including very short sentences
- admitted uncertainty about a particular thing ("I have not tested this above 200 req/s") rather than global hedging
- an actual stake or opinion the writer could be wrong about
- a detail that serves no argument and is there because it happened
- jargon used correctly and without explanation, which signals the audience is known
- endings that stop rather than conclude

A draft that passes every removal check and has none of these still reads as machine text. The additions matter more than the deletions.

---

## 11. Weak signals, do not act on alone

- em dash presence by itself
- one rule-of-three list
- any single word from the vocabulary list
- formal or academic register (the correlation is with specific words, not with formality generally)
- "bland" prose, which is a judgment that varies with reader familiarity
- AI detector scores. The guide is explicit that detectors produce false positives and false negatives, hide their method, and should never be sole evidence.

Consistent style across a writer's history is evidence in the other direction: a person whose voice has not changed is probably still writing.
