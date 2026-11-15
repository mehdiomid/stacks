## Summary

| Job | Works locally? | Best option |
|---|---|---|
| Choose the folder (+ 2 other picks) | **Yes.** About 4 in 5 right first time, and the right folder is in the top 3 about 96–99% of the time | ≤50 MB: **snowflake-arctic-embed-xs** (24 MB + 7 MB runtime). ≤200 MB: **bge-base-en-v1.5** (111 MB + 7 MB) |
| Add to an existing item | **Yes**, with a code check that both titles share a distinctive word (17/18 right with any model) | Any embedding model above; the check does most of the work |
| Notice that no folder fits | **Not reliably**, with any model (66–75% separation, where 50% is a coin flip) | Don't decide automatically; let the tray offer "New folder" |
| Propose a name for a new folder | **Weak.** Roughly a third of the names are good; the rest are too broad ("Robotics"), off ("Painting" for a Rust book) or garbled | Qwen3-0.6B (397 MB) or Gemma 3 270M (253 MB), as an editable suggestion |
| Crash risk | **None seen.** The heaviest setup (a naming model) peaked at about 1.2 GB for the whole Chrome | – |

Everything ran in Chrome on this Mac (Intel i7, 2019), CPU only, with no API calls.

## Choosing the folder

- **Every embedding model clearly beats plain word overlap:** about 79–85% top-1 against 48%.
- **Model size matters less than expected:**
  - The 24 MB snowflake-arctic-embed-xs gets 82% top-1 and 96% top-3.
  - The 111 MB bge-base gets 85% and 99%.
  - The two largest models (nomic at 138 MB, EmbeddingGemma at 218 MB) are **no better**, and much slower: 0.5–1.4 s per paste, with up to 1.9 GB of memory.
- **How a folder is scored matters as much as the model.** Comparing the paste with the folder's average (*centroid*) beats the 50/50 mix used in the main table for most models; bge-base reaches **91%** that way. That method was chosen after seeing these results (out of 3 tried), so expect a bit less on real data.
- **Speed is not an issue for the small models:**
  - snowflake-arctic-embed-xs: 0.9 s to load, 29 ms per paste, 11 s to prepare 1,000 saved items (once), and about 460 MB of extra memory.
  - bge-base: 2.3 s to load, 147 ms per paste, 75 s per 1,000 items, and about 740 MB.
- **On your real export** (only 5 items, so treat this as anecdote):
  - The models confuse Robotics › Papers with Robotics › Robot Learning and Open Models. With just 1–2 items per folder, a folder is described almost only by its name.
  - This gets better as folders fill up.
  - The right folder was always in the top 2–3, so it would be one of the quick picks.

## Adding to an existing item

- **Similarity alone confuses similar courses.** CS234 Reinforcement Learning looks just like a saved CS285 Deep RL lecture, and a Neapolitan pizza video looks like a saved sourdough pizza series. On its own it gets 13–16 of 18 right.
- **With the shared-name check, every model gets 17 of 18** (plain word overlap even gets 18 of 18). The check requires that both titles share a distinctive word, such as "cs231n", "rustlings" or "couch"; the new paste's own notes count too.
- **The model barely matters here; the check does the work.** It works well for courses and series with a name.
- **The remaining false join** passes the check through a word that isn't really a name ("reinforcement", "modern", "dough"). A stricter rule would fix it, for example counting only course codes and capitalized names. Keeping the tray's "Add to …" checkbox, so you confirm, covers the rest.

## Noticing that no folder fits

**No model can tell "this needs a new folder" from "this fits an existing one" well enough to decide automatically.** At the best cut-off, models either keep about 85% of items that do fit while flagging only about half of the new ones, or the other way round.

The design should not depend on this:
- always show the top folder and the 2 quick picks;
- show **"+ New folder"** with a proposed name next to them;
- when the top score is low, select "+ New folder" first, but let you switch.

## Naming a new folder

- **Small models need examples, not rules.** Without examples (prompt v1), they mostly repeated the parent folder or the instructions; Gemma answered "Okay. I'm Ready." With worked examples (v2), or by asking what the item is about (v3), 16–19 of 20 names are at least usable.
- **Usable isn't good.** Going by the side-by-side tables in section 4, about a third of the names are names you'd keep: Pizza, Linear Algebra, Object Detection, Travel › Japan, Ecosystem, Open-Weight Models. The rest are too broad ("Robotics", "Machine Learning"), off-topic ("Painting" for a Rust book, copied from an example), or garbled ("Index Funds &ETFs..getIndexFund."). Only 1–3 of 20 match your real name exactly.
- **Best of the four:**
  - **Qwen3-0.6B (v3):** 2.7 s per name, 397 MB download, about 0.9 GB of memory.
  - **Gemma 3 270M (v2):** 5.2 s per name, 253 MB, about 0.7 GB.
  - Qwen2.5-0.5B and SmolLM2-360M were no better (the SmolLM2 v2 run hung and timed out, and wasn't rerun).
- **Speed on this Mac:**
  - The first name in a session takes 12–34 s while the runtime warms up; after that, 3–5 s.
  - The CPU reads prompts at only about 7–12 tokens per second in the browser. Changing the quantization (Q4_0, Q8_0) or the runtime (ONNX) didn't fix that, and ONNX used 2–3 GB of memory.
  - More threads helped up to 4; 8 was much slower.

**Verdict:** local naming works only as a rough suggestion that you edit. It's nowhere near the quality of the API model the app uses now. If you go fully local:
- download the naming model (about 400 MB) only the first time a new folder is needed, not when the app starts;
- show its suggestion in an editable box.

## Recommendation (for a fully local version)

1. **Folder choice and joining:** **snowflake-arctic-embed-xs** (31 MB in total with the runtime, compressed) if you want to stay under 50 MB, or **bge-base-en-v1.5** (118 MB) for the best accuracy under 200 MB. Score folders by their average (centroid), and keep the shared-name check for joining.
2. **New folders:** don't detect them automatically. Always offer "+ New folder" in the tray, preselected when the top score is low.
3. **Naming:** Qwen3-0.6B (397 MB), downloaded on first use, as an editable suggestion. Or skip the naming model and have you type the name. The test shows a local model saves typing only about a third of the time.

## Caveats

- **The main numbers come from a synthetic library I wrote** (136 items, 17 folders, `data/synthetic.json`), because your export has only 5 items. Real libraries are messier: page titles like "LinkedIn", long pasted posts, uneven folders.
- **Cut-offs were tuned on the same data,** so results on new data will be somewhat lower.
- **One machine, CPU only.** Apple Silicon, or the GPU through WebGPU, would be much faster, especially for naming. That wasn't tested.
- **An unrelated issue spotted in your export:** the note of "Agentic World Action Models" starts with "Put the following under". It was saved before that bug was fixed, and you can remove the line by editing the item.

