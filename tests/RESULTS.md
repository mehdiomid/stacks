# Local models for Stacks: assessment

Can a model running in the browser, with no API calls, choose the folder for a new paste, notice when no folder fits and name a new one, and add a paste to an existing item? Measured on this Mac, CPU only.

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


## 1. Embedding models: choosing the folder

Synthetic library: 136 items in 17 two-level folders. Each item is hidden in turn and the model ranks every folder, described as the app would describe it: its path plus its latest 5 items.

| Model | Download (model + runtime, gzip) | Top-1 | Top-3 | Load (cached) | Per paste | Prepare 1,000 items | Extra memory |
|---|---|---|---|---|---|---|---|
| Word overlap (baseline, no model) | none | **48%** | 62% | 0.0 s | 0 ms | 0 s | 59 MB |
| potion-base-8M | 31 MB + 0.2 MB | **66%** | 89% | 0.1 s | 0 ms | 0 s | 104 MB |
| all-MiniLM-L6-v2 | 24 MB + 6.9 MB | **79%** | 96% | 1.3 s | 31 ms | 23 s | 461 MB |
| snowflake-arctic-embed-xs | 24 MB + 6.9 MB | **82%** | 96% | 0.9 s | 29 ms | 11 s | 458 MB |
| bge-small-en-v1.5 | 35 MB + 6.9 MB | **79%** | 98% | 1.1 s | 50 ms | 27 s | 617 MB |
| bge-base-en-v1.5 | 111 MB + 6.9 MB | **85%** | 99% | 2.3 s | 147 ms | 75 s | 743 MB |
| snowflake-arctic-embed-m-v1.5 | 111 MB + 6.9 MB | **82%** | 95% | 1.2 s | 142 ms | 51 s | 852 MB |
| nomic-embed-text-v1.5 | 138 MB + 6.9 MB | **76%** | 94% | 1.7 s | 477 ms | 150 s | 955 MB |
| EmbeddingGemma-300M (q4) | 215 MB + 6.9 MB | **79%** | 93% | 5.5 s | 1415 ms | 491 s | 1872 MB |

- *Per paste*: embedding one 49-word paste (median of 10). *Prepare 1,000 items*: one-time cost to embed saved items, measured on 136.
- *Extra memory*: peak memory of the Chrome process tree during the run, minus an empty page (321 MB).
- *Runtime*: the ONNX runtime and Transformers.js, shared by all models except potion and the baseline. Uncompressed sizes are in section 6.

Scoring method (top-1), on the same models: *max* is the closest single item, *centroid* the average of the folder, *hybrid* the mean of both (used above).

| Model | max | centroid | hybrid |
|---|---|---|---|
| Word overlap (baseline, no model) | 48% | 46% | 48% |
| potion-base-8M | 58% | 66% | 66% |
| all-MiniLM-L6-v2 | 67% | 84% | 79% |
| snowflake-arctic-embed-xs | 78% | 82% | 82% |
| bge-small-en-v1.5 | 69% | 79% | 79% |
| bge-base-en-v1.5 | 77% | 91% | 85% |
| snowflake-arctic-embed-m-v1.5 | 74% | 82% | 82% |
| nomic-embed-text-v1.5 | 68% | 79% | 76% |
| EmbeddingGemma-300M (q4) | 72% | 76% | 79% |

## 2. Noticing that no folder fits

Each folder is hidden in turn, with all its items. Its items should then score lower than items that do have a folder. *Separation* is the chance that an item with a folder scores higher than one without (50% = no signal, 100% = perfect). The threshold is the best single cut-off; it was picked on this same data, so real results will be somewhat lower.

| Model | Separation | Best threshold | Items with a folder kept | Items needing a new folder flagged | Right parent for a new subfolder |
|---|---|---|---|---|---|
| Word overlap (baseline, no model) | **66%** | 0.106 | 65% | 62% | 45% |
| potion-base-8M | **70%** | 0.412 | 69% | 65% | 59% |
| all-MiniLM-L6-v2 | **74%** | 0.447 | 67% | 74% | 65% |
| snowflake-arctic-embed-xs | **73%** | 0.857 | 49% | 86% | 70% |
| bge-small-en-v1.5 | **70%** | 0.720 | 85% | 47% | 71% |
| bge-base-en-v1.5 | **74%** | 0.683 | 89% | 51% | 68% |
| snowflake-arctic-embed-m-v1.5 | **68%** | 0.742 | 56% | 76% | 67% |
| nomic-embed-text-v1.5 | **75%** | 0.743 | 79% | 59% | 57% |
| EmbeddingGemma-300M (q4) | **75%** | 0.693 | 79% | 58% | 68% |

## 3. Adding to an existing item

18 new pastes: 10 continue a saved course (Lecture 5 of a saved CS231n, Couch to 5K week 4…) and 8 are a *different* course on a similar subject (CS234 vs a saved CS285, a Neapolitan pizza video vs a saved sourdough series). The model compares each paste with the latest 5 items of every folder. Threshold picked on this data, as above.

| Model | Similarity only: correct | joined right / missed / wrong item | false joins | With shared-name check: correct | joined right / missed / wrong item | false joins |
|---|---|---|---|---|---|---|
| Word overlap (baseline, no model) | 16/18 | 10 / 0 / 0 | 2/8 | **18/18** | 10 / 0 / 0 | 0/8 |
| potion-base-8M | 15/18 | 9 / 1 / 0 | 2/8 | **17/18** | 10 / 0 / 0 | 1/8 |
| all-MiniLM-L6-v2 | 16/18 | 9 / 1 / 0 | 1/8 | **16/18** | 10 / 0 / 0 | 2/8 |
| snowflake-arctic-embed-xs | 14/18 | 9 / 0 / 1 | 3/8 | **17/18** | 10 / 0 / 0 | 1/8 |
| bge-small-en-v1.5 | 13/18 | 9 / 0 / 1 | 4/8 | **17/18** | 10 / 0 / 0 | 1/8 |
| bge-base-en-v1.5 | 13/18 | 7 / 3 / 0 | 2/8 | **17/18** | 10 / 0 / 0 | 1/8 |
| snowflake-arctic-embed-m-v1.5 | 13/18 | 5 / 5 / 0 | 0/8 | **17/18** | 10 / 0 / 0 | 1/8 |
| nomic-embed-text-v1.5 | 14/18 | 7 / 3 / 0 | 1/8 | **17/18** | 10 / 0 / 0 | 1/8 |
| EmbeddingGemma-300M (q4) | 15/18 | 9 / 1 / 0 | 2/8 | **17/18** | 10 / 0 / 0 | 1/8 |

*Shared-name check*: the two titles must share a distinctive word (one that appears in at most 3 titles and isn't a generic word like lecture, course, learning, robot). This is code, not a model.

## 4. Naming a new folder (generative models)

Each folder is hidden in turn. The model gets its first item (and, for prompts v1–v2, the parent folder and its other subfolders) and proposes a name: 1–3 words, forced by a grammar. When the whole area is new (Finance, Fitness, Travel, and the real Open Models) it proposes "Area › Subject". 20 cases: 17 synthetic, 3 from your export.

- *Usable*: not empty, not the parent or an existing subfolder, and not instruction words ("Area › Subject", "Okay. I'm Ready.").
- *Meaning match*: how close the name is to the real folder name according to bge-small (1.0 = same meaning; unrelated words score about 0.4–0.5).
- Speed is the median per name after the first; the first name of a session is slower (the runtime warms up). v1 ran with 2 threads, v2 and v3 with 4.

| Model | Prompt | Usable | Exact name | Meaning match (avg) | Per name (median) | First name | Extra memory |
|---|---|---|---|---|---|---|---|
| SmolLM2-360M-Instruct (Q4_K_M) | v1: rules in text | 5/20 | 0/20 | 0.62 | 20.1 s | 37 s | 741 MB |
| SmolLM2-360M-Instruct (Q4_K_M) | v3: "what is it about?" with examples | 17/20 | 3/20 | 0.70 | 3.1 s | 34 s | 376 MB |
| Gemma 3 270M-IT (Q4_K_M) | v1: rules in text | 1/20 | 0/20 | 0.51 | 9.5 s | 13 s | 722 MB |
| Gemma 3 270M-IT (Q4_K_M) | v2: worked examples | 19/20 | 3/20 | 0.70 | 5.2 s | 6 s | 737 MB |
| Gemma 3 270M-IT (Q4_K_M) | v3: "what is it about?" with examples | 18/20 | 1/20 | 0.63 | 5.1 s | 11 s | 644 MB |
| Qwen2.5-0.5B-Instruct (Q4_K_M) | v1: rules in text | 9/20 | 1/20 | 0.70 | 20.5 s | 32 s | 804 MB |
| Qwen2.5-0.5B-Instruct (Q4_K_M) | v2: worked examples | 7/20 | 2/20 | 0.71 | 5.8 s | 28 s | 834 MB |
| Qwen2.5-0.5B-Instruct (Q4_K_M) | v3: "what is it about?" with examples | 12/20 | 3/20 | 0.72 | 2.8 s | 18 s | 828 MB |
| Qwen3-0.6B (Q4_K_M, thinking off) | v1: rules in text | 10/20 | 1/20 | 0.63 | 12.1 s | 23 s | 892 MB |
| Qwen3-0.6B (Q4_K_M, thinking off) | v2: worked examples | 19/20 | 2/20 | 0.72 | 5.3 s | 16 s | 927 MB |
| Qwen3-0.6B (Q4_K_M, thinking off) | v3: "what is it about?" with examples | 16/20 | 3/20 | 0.73 | 2.7 s | 12 s | 866 MB |

| Model | Download (model + runtime, gzip) | First load (download) | Load (cached) |
|---|---|---|---|
| SmolLM2-360M-Instruct (Q4_K_M) | 271 MB + 2.6 MB | 21 s | 4.7 s |
| Gemma 3 270M-IT (Q4_K_M) | 253 MB + 2.6 MB | 15 s | 3.3 s |
| Qwen2.5-0.5B-Instruct (Q4_K_M) | 398 MB + 2.6 MB | 28 s | 5.3 s |
| Qwen3-0.6B (Q4_K_M, thinking off) | 397 MB + 2.6 MB | 24 s | 4.0 s |

Every suggestion with prompt v3, next to the real folder:

| Set | Real folder | First item | SmolLM2-360M-Instruct | Gemma 3 270M-IT | Qwen2.5-0.5B-Instruct | Qwen3-0.6B |
|---|---|---|---|---|---|---|
| synthetic | Robotics › Papers | RT-2: Vision-Language-Action Models Transfer Web Knowledge t | Computer Vision | Visualizing AI-driven Robotic-Control. | Robotics | Robot |
| synthetic | Robotics › Robot Learning | Imitation learning explained: behavior cloning vs DAgger | Behaviorism | I'm Interested. | Behaviorism | Behavioral Robotics |
| synthetic | Robotics › Hardware | Choosing servo motors for a robot arm | Robotics | Robot Arm | Robotics | Robotics |
| synthetic | Robotics › ROS & Simulation | ROS 2 Humble tutorial: publishers and subscribers | Python | Art | Robotics | Writing |
| synthetic | Machine Learning › LLMs | LoRA: Low-Rank Adaptation of Large Language Models | Computer Vision | AI | Machine Learning | Parameter-efficient |
| synthetic | Machine Learning › Computer Vision | YOLO object detection explained | Computer Vision | Object Detection | Computer Vision | Object Detection |
| synthetic | Machine Learning › Courses | Andrew Ng Machine Learning Specialization — Course 1 | Machine Learning | Machine Learning | Machine Learning | Machine Learning |
| synthetic | Machine Learning › Math | 3Blue1Brown: Essence of Linear Algebra | Mathematics | Visualizing Vectors | Mathematics | Linear Algebra |
| synthetic | Open Models › Releases | Llama 4 release notes | Llama 4 | Llama 4 ReleaseNotes-Meta's' | Sports | Open-Weight Models |
| synthetic | Open Models › Ecosystem | Open models lecture: ecosystem, debates, and future access | Science | Open Models | Ecology | Ecosystem |
| synthetic | Programming › Rust | The Rust Book: ownership chapter | Business | Painting | Books | Painting |
| synthetic | Programming › TypeScript | TypeScript generics deep dive | Programming Language | Art | Programming | Programming |
| synthetic | Cooking › Pizza | Neapolitan pizza at home in a regular oven | Pizza | Pizza | Cooking | Pizza |
| synthetic | Cooking › Japanese Food | How to make tonkotsu ramen broth | Soup | Recipe | Japanese Cuisine | Broth |
| synthetic | Finance › Investing | Index funds vs ETFs explained | Investments › Index Funds Vs.ETFs | Indexes › Stocks | Finance › Investing | Index Funds &ETFs..getIndexFund. › ETFs. |
| synthetic | Fitness › Running | Zone 2 training for runners | Training › Running Training | Training › Training | Running › Training Methods | Runners › Training |
| synthetic | Travel › Japan | Two weeks in Japan itinerary | Travel › Japan | Japan › Travel | Travel › Japan | Itinerary › Japan |
| real | Robotics › Papers | Agentic World Action Models | Game Design | Action Models | Modeling | Paper |
| real | Open Models | Open models lecture: ecosystem, debates, and future access | Science › Ecology | Language › Spanish | Ecology › Ecology | Ecosystems › Open Model Lecture |
| real | Robotics › Robot Learning | Modern Robot Learning from Scratch — Lectures 3–4 | Deep Learning | Here's 3-4-5-10-10- | Robotics | Robotics |

Every suggestion with prompt v2, next to the real folder:

| Set | Real folder | First item | Gemma 3 270M-IT | Qwen2.5-0.5B-Instruct | Qwen3-0.6B |
|---|---|---|---|---|---|
| synthetic | Robotics › Papers | RT-2: Vision-Language-Action Models Transfer Web Knowledge t | AI | Robotics | Vision-Language-Act |
| synthetic | Robotics › Robot Learning | Imitation learning explained: behavior cloning vs DAgger | Simulation | Robotics | Behavior |
| synthetic | Robotics › Hardware | Choosing servo motors for a robot arm | Robot | Robotics | Robotics |
| synthetic | Robotics › ROS & Simulation | ROS 2 Humble tutorial: publishers and subscribers | ROS | Robotics | ROS |
| synthetic | Machine Learning › LLMs | LoRA: Low-Rank Adaptation of Large Language Models | AI | Machine Learning | Parameter |
| synthetic | Machine Learning › Computer Vision | YOLO object detection explained | AI | Machine Learning | Object Detection |
| synthetic | Machine Learning › Courses | Andrew Ng Machine Learning Specialization — Course 1 | Machine Learning | Machine Learning | Supervised |
| synthetic | Machine Learning › Math | 3Blue1Brown: Essence of Linear Algebra | Physics | Linear Algebra | Mathematics |
| synthetic | Open Models › Releases | Llama 4 release notes | Model | Open Models | Llama |
| synthetic | Open Models › Ecosystem | Open models lecture: ecosystem, debates, and future access | Environmental Science | Open Models | Ecosystem |
| synthetic | Programming › Rust | The Rust Book: ownership chapter | Rust | Programming | Ownership |
| synthetic | Programming › TypeScript | TypeScript generics deep dive | TypeScript | Programming | Language |
| synthetic | Cooking › Pizza | Neapolitan pizza at home in a regular oven | Pizza | Italian Cuisine | Oven |
| synthetic | Cooking › Japanese Food | How to make tonkotsu ramen broth | Pasta | Dishes | Ramen |
| synthetic | Finance › Investing | Index funds vs ETFs explained | Investing › Finance | Index Funds › ETFs | Index Funds › ETFs |
| synthetic | Fitness › Running | Zone 2 training for runners | Languages › Programming | Training › Running | Training › Zone 2 |
| synthetic | Travel › Japan | Two weeks in Japan itinerary | Japan › Culture | Itinerary › Japan | Technology › Programming |
| real | Robotics › Papers | Agentic World Action Models | Agentic World ActionModels | Robotics | Paper |
| real | Open Models | Open models lecture: ecosystem, debates, and future access | Languages › Robotics | Robotics › Open Models Lecture | Technology › Open Models |
| real | Robotics › Robot Learning | Modern Robot Learning from Scratch — Lectures 3–4 | AI | Robotics | Learning |

### Why naming is slow, and whether another runtime helps

llama.cpp's own timings show this CPU reads the prompt at about 7–12 tokens per second in the browser, so a ~150–300 token prompt takes several seconds. Checked on Qwen2.5-0.5B, 4 names each:

| Setup | Per name (after the first) | Prompt speed | Peak memory (whole Chrome) |
|---|---|---|---|
| wllama, Q4_K_M, 2 threads, grammar | 8.2 s | 6.8 tok/s | – MB |
| wllama, Q4_K_M, 4 threads, grammar | 7.8 s | 7.9 tok/s | – MB |
| wllama, Q4_K_M, 4 threads, no grammar | 6.1 s | 9.3 tok/s | – MB |
| wllama, Q4_K_M, 8 threads, no grammar | 35.1 s | 3.5 tok/s | – MB |
| wllama, Q4_0, 2 threads | 9.5 s | 5.8 tok/s | 1158 MB |
| wllama, Q4_0, 4 threads | 7.4 s | 7.7 tok/s | 1167 MB |
| wllama, Q8_0, 2 threads | 7.0 s | 7.9 tok/s | 1145 MB |
| wllama, Q8_0, 4 threads | 5.3 s | 10.6 tok/s | 1296 MB |
| ONNX runtime, Qwen2.5-0.5B int8 | 4.9 s | – | 3125 MB |
| ONNX runtime, SmolLM2-360M int8 | 6.0 s | – | 1987 MB |

## 5. Your real export (5 items, 4 folders)

Too small to score: each item is hidden in turn and ranked against the remaining folders. Shown for the strongest small and large models.

**bge-small-en-v1.5**

| Item | Real folder | 1st | 2nd |
|---|---|---|---|
| Agentic World Action Models | Robotics › Papers | Open Models (0.74) | Robotics › Papers (0.731) |
| Modern Robot Learning from Scratch — Lectures 3–4 | Robotics › Robot Learning | Robotics › Robot Learning (0.818) | Robotics › Papers (0.779) |
| Observing and Controlling Features in Vision-Language-Action | Robotics › Papers | Open Models (0.791) | Robotics › Robot Learning (0.775) |
| Open models lecture: ecosystem, debates, and future access | Open Models | Open Models (0.786) | Robotics › Papers (0.742) |
| An Introduction to Open Source AI | Open Models | Open Models (0.822) | Robotics › Papers (0.793) |

**snowflake-arctic-embed-m-v1.5**

| Item | Real folder | 1st | 2nd |
|---|---|---|---|
| Agentic World Action Models | Robotics › Papers | Open Models (0.79) | Robotics › Papers (0.741) |
| Modern Robot Learning from Scratch — Lectures 3–4 | Robotics › Robot Learning | Robotics › Robot Learning (0.632) | Robotics › Papers (0.577) |
| Observing and Controlling Features in Vision-Language-Action | Robotics › Papers | Robotics › Robot Learning (0.548) | Open Models (0.489) |
| Open models lecture: ecosystem, debates, and future access | Open Models | Open Models (0.73) | Robotics › Papers (0.636) |
| An Introduction to Open Source AI | Open Models | Open Models (0.845) | Robotics › Papers (0.787) |

**bge-base-en-v1.5**

| Item | Real folder | 1st | 2nd |
|---|---|---|---|
| Agentic World Action Models | Robotics › Papers | Robotics › Papers (0.675) | Open Models (0.632) |
| Modern Robot Learning from Scratch — Lectures 3–4 | Robotics › Robot Learning | Robotics › Papers (0.769) | Robotics › Robot Learning (0.764) |
| Observing and Controlling Features in Vision-Language-Action | Robotics › Papers | Robotics › Robot Learning (0.754) | Robotics › Papers (0.695) |
| Open models lecture: ecosystem, debates, and future access | Open Models | Open Models (0.731) | Robotics › Papers (0.654) |
| An Introduction to Open Source AI | Open Models | Open Models (0.749) | Robotics › Robot Learning (0.675) |

## 6. Setup and sizes

- Machine: this Mac, Intel Core i7-8569U (4 cores, 8 threads), 16 GB RAM. Browser: HeadlessChrome/157.0.0.0, headless, GPU off (`--disable-gpu`), cross-origin isolated = True (wasm threads on). The browser saw 4 cores.
- Libraries: Transformers.js 4.3.2 (ONNX Runtime Web 1.31.0-dev), wllama 3.8.1 (llama.cpp). Models from Hugging Face, cached in a separate Chrome profile.
- Runtime files, uncompressed / gzip:
  - `transformers.min.js`: 0.6 MB / 0.2 MB
  - `ort/ort-wasm-simd-threaded.asyncify.mjs`: 0.1 MB / 0.0 MB
  - `ort/ort-wasm-simd-threaded.asyncify.wasm`: 26.9 MB / 6.7 MB
  - `ort/ort-wasm-simd-threaded.mjs`: 0.0 MB / 0.0 MB
  - `ort/ort-wasm-simd-threaded.wasm`: 14.3 MB / 3.7 MB
  - `wllama/index.js`: 0.4 MB / 0.2 MB
  - `wllama/wllama.wasm`: 8.8 MB / 2.4 MB
- Code: `make_synthetic.py` (test library), `bench/bench.js` (runs in the browser), `run_bench.py` (server, Chrome, memory; first full run with naming prompt v1), `run_naming.py` (naming prompts v2 and v3, 4 threads), `diag_speed.py` / `diag_quant.py` / `diag_onnx.py` (the speed checks in section 4), `make_report.py` (this report). Raw results: `results/raw/`; written findings: `results/findings.md`.
- Re-run: `python3 tests/make_synthetic.py && python3 tests/run_bench.py && python3 tests/run_naming.py && python3 tests/make_report.py`.
