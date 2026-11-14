# Stacks

A local-first assistant for everything you mean to read or watch: articles, YouTube videos, courses and quick notes.

Paste one link, or dump a whole notebook page of links and notes, and Stacks sorts every piece into the right topic. Topics are ranked by importance with drag and drop. An **Up next** panel keeps recommending what to get to, based on topic importance and on what you've been neglecting. Check items off as you finish them, and each one lights a gold star in the background.

Your lists stay on your device. The server stores nothing, even when Stacks is hosted in the cloud.

---

## Contents

1. [Quick start](#quick-start)
2. [Features](#features)
3. [How it works](#how-it-works)
4. [Where your data lives (local-first)](#where-your-data-lives-local-first)
5. [AI: providers, keys and cost control](#ai-providers-keys-and-cost-control)
6. [How "Up next" picks](#how-up-next-picks)
7. [Smart input rules](#smart-input-rules)
8. [Folders, subfolders and `\` paths](#folders-subfolders-and--paths)
9. [Backups, export and import](#backups-export-and-import)
10. [Configuration](#configuration)
11. [Hosting on a server](#hosting-on-a-server)
12. [Security and privacy](#security-and-privacy)
13. [Design](#design)
14. [Development](#development)
15. [Project structure](#project-structure)
16. [Decision log](#decision-log)
17. [Roadmap](#roadmap)
18. [Troubleshooting](#troubleshooting)

---

## Quick start

You need Docker (Docker Desktop, Colima or similar). Node.js is not needed on your machine.

```bash
cd stacks
docker compose up -d --build
```

Open **http://localhost:8080**.

1. Click **Add API key** (top right) and paste a Claude or OpenAI API key (see [AI](#ai-providers-keys-and-cost-control)).
2. Paste links or notes into the box and press **Add** (or `Ctrl`/`⌘` + `Enter`). Everything you paste becomes one item; tick **Several things** to split a paste into separate items.
3. Check the title and folder, then press **Add item**.

To try the app without a key, click **Load example topics** on the empty page.

Stop it with `docker compose down`. Your data is unaffected because it lives in your browser, not in the container.

---

## Features

| Area | What it does |
|---|---|
| **Smart input** | One box for everything. By default the whole paste is **one item**: a post with its video, slides and reading list, or a course with its lectures, keeps all its links, and your words are kept as its notes. The AI only finds where it goes, offers two other folders as quick picks, and can add it to an item you already have when it continues it (the next lecture of a saved course). Tick **Several things** to split a big mixed dump into separate items. |
| **AI grouping and sorting** | The AI groups the lines into items, titles them, and files each in the best existing topic or suggests a new one. You review everything in a tray, change any topic, then add. |
| **Instructions** | Type into the same box: "move all pizza links to Cooking", "mark the Karpathy video done", "snooze finance for two weeks", "make Rust my top priority". Stacks lists the exact changes and waits for you to apply them. |
| **Rich previews** | Title, description, site, author, thumbnail, and duration for videos (YouTube and Vimeo via oEmbed, other sites via Open Graph tags). |
| **Short links** | `lnkd.in` links (LinkedIn's "you're leaving LinkedIn" page), pages that redirect with `<meta http-equiv="refresh">`, and ordinary redirects are followed to the real page, which is the link Stacks saves. Useless previews (a title like "LinkedIn" or "Just a moment…", a favicon as the image) are ignored in favor of your own text and the AI's title. |
| **Fixing items** | Each item's ⋯ menu has **Edit** (title and notes) and **Refresh preview**. A topic's ⋯ menu has **Refresh previews** for all its links. Clicking an item's title, thumbnail or text (or **Show more**) expands it to show the full notes and its links; the links are only shown there. |
| **Duplicates** | Links you already saved are recognized (tracking parameters and `youtu.be` short links are normalized) and left unchecked. |
| **Ranked topics** | Drag the ⋮⋮ handle up or down to reorder, on desktop or touch. Keyboard users can focus the handle and press ↑/↓. The rank badge shows priority ("2", or "2.1" for the first folder inside the second). |
| **Folders and subfolders** | Topics can hold subfolders, up to 3 levels: Robotics › Papers › Grasping. Write `\robotics\papers` in the box to choose the folder yourself; it's created if it doesn't exist. Typing `\` lists your folders. Drag a topic right to put it inside the one above, left to take it out. See [Folders, subfolders and `\` paths](#folders-subfolders-and--paths). |
| **Topic cards** | Expand and collapse, progress bar (counting subfolders too), "untouched N days" warning, sort by oldest, newest or title, rename, **+ Subfolder**, **Move into…**, delete, and a "N done" fold. |
| **Up next** | Always-visible recommendations with the reason for each pick. Done, Snooze 3 days, Not interested, Open. |
| **Reminders** | Optional desktop notification, once a day at most, for your top pick while the app is open. |
| **Progress** | A line under the title ("3 more and Machine Learning is halfway done") and a gold star for every finished item. |
| **Examples and starting over** | **Load example topics** on the empty page fills in sample topics. While they're there, a banner offers **Remove examples**: it removes only the example items, and any example topic you added your own items to is kept as yours. **Settings → Start over → Delete all my lists** wipes every topic and item but keeps settings, API keys and the backup folder. |
| **Collapsible input** | Collapse the box to a one-line bar so topics sit near the top. Press `/` anywhere to open it again. The choice is remembered. |
| **Backups** | Automatic JSON backup to a folder you choose (Chrome, Edge, Brave), plus Export and Import. |
| **Two AI providers** | Claude (Anthropic) or OpenAI, using your own key, with a per-browser daily token limit. |
| **About page** | `#about` explains usage, scoring, storage, AI and privacy inside the app, starting with a highlighted note that your lists stay on your device. On the first visit, while nothing is saved yet, Stacks opens on this page, with **Try Stacks** buttons between the sections. |
| **Themes** | Light and dark follow the system setting. Works at phone width. Respects reduced motion. |

---

## How it works

```
┌──────────────────────── Your browser (your device) ────────────────────────┐
│  React app                                                                  │
│   ├─ IndexedDB (Dexie)  ← the source of truth: topics, items, settings      │
│   ├─ Backup folder on disk (File System Access API, optional)               │
│   └─ AI adapter ── HTTPS, your key ──► api.anthropic.com / api.openai.com    │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ GET /  (the app)      GET /api/preview?url=…  (link metadata)
┌───────────────▼───────── Docker container (stateless) ─────────────────────┐
│  Fastify server                                                             │
│   ├─ serves the built app with a strict Content-Security-Policy             │
│   └─ /api/preview: fetches a page's title/description/image                 │
│        • blocks private and cloud-metadata addresses (also after DNS)       │
│        • rate-limited, no request logs, stores nothing                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

The server exists for two reasons:

- **To serve the app.**
- **To fetch link previews.** Browsers aren't allowed to read other websites' HTML (CORS), so a small server does it.

It has no database and keeps no state between requests.

---

## Where your data lives (local-first)

**Can an app hosted on a cloud server keep everything on the user's machine?** Yes. The server only delivers the app's code. Everything you add is written to **IndexedDB**, a database built into every browser, on your device. The server never receives your lists.

Stacks takes these extra steps so the data is safe and portable:

- **Persistent storage.** On start, Stacks calls `navigator.storage.persist()` so the browser doesn't evict its data when disk space runs low. The **AI usage today** part of Settings shows "this browser (protected)" when this was granted.
- **Backup folder.** In Chrome, Edge and Brave you can choose a real folder on disk, such as `~/Documents/Stacks` or an iCloud, Dropbox or Syncthing folder. Stacks writes `stacks-backup.json` a few seconds after every change, plus one dated snapshot per day (`stacks-2026-10-19.json`). After a browser restart, the browser asks you to **Reconnect folder** once. Safari and Firefox don't offer this API, so use Export there.
- **Export and Import.** These move your lists between browsers or computers. Import can **add to** or **replace** your lists. API keys are never exported.

Limits to know about:

- Data belongs to one browser profile on one device. A phone and a laptop don't share it unless you move a backup between them.
- Clearing site data for Stacks in your browser deletes the lists. That's what the backup folder is for.
- The data is tied to the address you open Stacks at. `http://localhost:8080` and `https://stacks.example.com` are separate stores.

**Tables in IndexedDB (`stacks` database):**

| Table | Contents |
|---|---|
| `topics` | id, name, order (priority), hue, createdAt, lastActivityAt, open, sort |
| `items` | id, topicId, kind (link/video/note), url, normUrl, title, description, siteName, author, image, duration, addedAt, doneAt, snoozedUntil, dismissed |
| `settings` | AI provider and models, daily limit, remembered keys, backup folder handle, reminder setting |
| `usage` | tokens used per calendar day |

---

## AI: providers, keys and cost control

### Bring your own key

Every user puts their own API key into **Settings**. The key is kept in the browser:

- In IndexedDB when **Remember keys on this device** is on.
- Otherwise in `sessionStorage`, which is cleared when the tab closes.

The browser calls the provider **directly**. Anthropic's SDK runs with `dangerouslyAllowBrowser`, and so does OpenAI's. The Stacks server never sees the key, and it never pays for anyone's usage.

**Can I use my Claude Pro/Max or ChatGPT Plus subscription instead?** No. Subscriptions cover the providers' own apps (claude.ai, Claude Code, ChatGPT). There is no supported way for third-party apps to sign in with a subscription, and reusing subscription login tokens in another app breaks the providers' terms. Create an API key instead:

- Claude: https://console.anthropic.com/settings/keys
- OpenAI: https://platform.openai.com/api-keys

API use is billed per use, separately from any subscription.

### Two providers, one interface

```
callAI()  ──►  adapter: Claude (src/ai/anthropic.ts)
               adapter: OpenAI (src/ai/openai.ts)
               (later: Ollama, Gemini, OpenRouter…)
```

The rest of the app only needs two jobs:

- **Title this item and find its folder** (`src/ai/place.ts`), for the default one-item mode.
- **Group this text into items and file them in topics** (`src/ai/group.ts`), for "Several things".
- **Turn this instruction into actions** (`src/ai/interpret.ts`).

Both ask for **structured JSON output** that follows a schema:

- Claude: `output_config.format` with a JSON schema.
- OpenAI: `response_format: json_schema` with `strict: true`.

Every reply is validated again with Zod before anything is used. Each SDK is loaded only the first time its provider is used, which keeps the page small.

| Provider | Default model | Options |
|---|---|---|
| Claude | `claude-haiku-5-5` (fast and cheap; enough for sorting) | `claude-sonnet-5-5`, `claude-opus-5-5` |
| OpenAI | `gpt-5-mini` | `gpt-5-nano`, `gpt-5`, or type any model that supports structured outputs |

Claude requests run at `effort: "low"`, because sorting is simple. Sonnet 5.5 and Opus 5.5 requests also turn on server-side refusal fallbacks (`fallbacks: "default"`).

### What is sent to the AI

| Request | What's sent |
|---|---|
| Placing one item (default) | Your folders as full paths in priority order, each with the titles of its latest 5 items (cut at 80 characters, at most 80 folders), plus your text and links as below. |
| Grouping and sorting ("Several things") | Your topic names as full paths like "Robotics › Papers" (in priority order), the text you pasted as numbered lines (each line cut at 400 characters, links replaced by `[L1]`-style references), and for each link: its address, site, page title, and the first 160 characters of its description. Full web pages are never sent. |
| Instructions | Your instruction, the topic paths with counts, and a numbered list of up to 400 items (title, topic, done or open, site). |

### Cost control

These are the cost-control layers we planned, as built:

1. **Use fewer tokens.**
   - Each dump is sorted in **one** request.
   - Descriptions are trimmed.
   - Links you've already saved are never sent again (duplicate detection).
   - A plain list of bare links, all of which are already saved or come from sites you've filed under one topic at least three times, is sorted **without the AI** ("same site as before"). General sites like YouTube, Medium or LinkedIn are excluded from that rule.
   - Hard caps: 100 links, 300 lines or 20,000 characters per round. Anything beyond that stays in the box for the next round.
   - The model's reply length is capped.
2. **Personal daily token limit** (default 200,000, set in Settings). Stacks estimates each call first and refuses it if it would go over the limit. The **AI usage today** meter at the end of Settings (the API key button at the top right) shows the count. A dump of 50 links costs roughly 10,000 tokens.
3. **Provider spend limit.** Set a monthly limit in the Anthropic Console or the OpenAI dashboard. This is the hard backstop, and Settings reminds you to set it.
4. **No silent fallback.** When there's no key, the key is rejected, or the account is out of credit, Stacks opens Settings and asks for a key. It never quietly sorts by keywords instead.

---

## How "Up next" picks

Every unfinished item that isn't snoozed or marked "Not interested" gets a score:

```
score = 0.45 × topic priority   (top topic = 1, decreasing down the list; see below for subfolders)
      + 0.35 × time waiting     (reaches full weight at 60 days)
      + 0.20 × topic neglect    (days since you finished anything in the topic; full at 30)
      + 0.05 × daily variation  (stable within a day, so the list doesn't shuffle on every click)
```

Priority follows the folder tree as it reads on the page: a folder, then the folders inside it, then the next folder. So Robotics › Papers (1.1) ranks right after Robotics (1) and before Cooking (2). Finishing something in a subfolder also counts as activity for the folders around it.

The panel shows the top four picks, at most two from any one topic (each subfolder counts as its own topic), so one big list can't crowd out the rest. Each pick carries a tag naming the factor that counted most: "Your top topic", "Waiting 52 days", or "Personal Finance untouched 41 days".

- **Done** marks the item finished and refreshes the topic's activity.
- **Snooze 3 days** hides it from Up next for three days.
- **Not interested** keeps it in its list but stops suggesting it.

The item's ⋯ menu has "Show in Up next again".

The code is in `src/lib/scoring.ts`, and the weights are in `WEIGHTS`.

---

## Smart input rules

### One item (the default)

Most pastes are one thing, so by default **everything in the box becomes one item**: all its links are listed, your words are kept as its notes, and the main link (the video for a talk) is the title link. Nothing is split, so nothing can break apart by mistake.

The AI (`src/ai/place.ts`) only answers three questions. It sees your folders with the titles of their latest 5 items, which helps it put a new lecture next to the course it belongs to.

- **Title and folder.** A short title, and a folder at least 2 levels deep, with the same rules as below. The review tray has one row: edit the title, change the folder, then press **Add item**.
- **Two other folders.** Shown as quick picks under the row ("Or: Robotics › Papers"), so a wrong guess is one click to fix.
- **Does this continue an item you already have?** For example, Lecture 5 of a course you saved. The tray then shows "Add to “Vizuara: Modern Robot Learning from Scratch”", ticked. Adding appends the new links (skipping ones already there) and your notes to that item, keeps its title and folder, and marks it not done again so it comes back in Up next. Untick it to save a new item instead. The AI is told to join only when both titles name the **same course, series, talk or project**; being a course, a lecture or about the same field is never enough, and when in doubt it doesn't join. It can only join an item it was shown (the latest 5 per folder), and with a folder you wrote, only one inside that folder.

Folder paths work as before, except that one item goes in one place:
- A path with 2 or more levels anywhere in the paste (`\robotics\papers`) is the item's folder, and the AI isn't called. The title is your first line when it reads as a heading, otherwise the page title.
- A 1-level path (`\robotics`) asks the AI for the subfolder inside it.
- With two different folders written, the first is used and the hint suggests ticking **Several things**.

A paste over the size limits (100 links, 300 lines, 20,000 characters) is too big for one item; the box asks you to tick **Several things**.

### Several things

Tick **Several things** under the box when a paste holds separate things. The button then reads **Sort it**, and the paste goes through the steps below; it can still end up as one item. The box is unticked again after each add, because splitting is the rare case.

Pasted text is split in two steps.

**1. Parsing** (`src/lib/parse.ts`) numbers the non-empty lines and pulls out their links. It also:
- turns Markdown links `[title](url)` into `title: url`;
- removes trailing punctuation from links, except a closing parenthesis that belongs to the link (Wikipedia style);
- notes paragraph breaks;
- strips list numbering, including `2-` and `3 –` (a year like "2024 - recap" is kept).

**2. Grouping** is done by the AI (`src/ai/group.ts`). It gets the numbered lines, with links replaced by references `[L1]`, `[L2]` and their page titles listed below. It returns which lines form one item, plus a title, a main link and a topic for each item. It returns only line numbers, never rewritten text, so:
- your exact words are kept;
- the reply stays small;
- every line ends up in exactly one item (a line the AI leaves out becomes its own item in Inbox).

Here's how text becomes items:

- **A post with its links becomes one item.** For example, a lecture announcement with its questions and "Video: … / Slides: … / Reading list: …" lines.
  - Its title comes from the AI.
  - Your text is kept as its notes, with paragraph breaks.
  - All its links are listed under it, with your labels ("Video", "Slides") and each page's own title. The main link (the video, for a talk) is the title link.
- **A course or series becomes one item.** A heading line ("Vizuara robotics from scratch") followed by numbered lectures and their links is one item listing every lecture link. The AI only splits when the subject changes; blank lines and numbering don't count. As a safety net in code, a heading line (short, no link, not a sentence) that the AI left on its own joins the item right below it.
- **Items are filed at least 2 levels deep**, like Robotics › Robot Learning: an area, then the subject. The AI picks an existing subfolder or proposes a new one. If it answers a single level anyway, the item goes to Inbox (the only 1-level choice) for you to pick in the review tray. A 1-level path you write (`\robotics`) means "somewhere in Robotics": the AI chooses the subfolder inside it. Manual moves and "+ New topic" can still use any level.
- **A list of unrelated links or ideas** gives one item per line. A single link uses its page's title.
- **Lines that only name a link** ("Video:", "Slides") become that link's label instead of a line of notes.
- **Instruction mode** starts automatically for a single line with no link that begins like a command: move, mark, create, rename, delete, snooze, put, merge, prioritize, and similar. Click the label above the box (**Add items ⇄ / Instruction ⇄**) to switch modes if the guess is wrong.
- **Folder paths** (`\robotics\papers`) are taken out of the text before anything else and decide the folder; see the next section.

---

## Folders, subfolders and `\` paths

### Writing a path

A path starts with `\`, and each further `\` goes one level deeper:

| You write | Folder |
|---|---|
| `\robotics` | Robotics |
| `\robotics\papers` | Robotics › Papers |
| `\machine-learning\open_models` | Machine Learning › Open Models (hyphens and underscores stand for spaces) |
| `\"Machine Learning"\papers` | Machine Learning › Papers (quotes allow spaces and keep the name exactly as written, e.g. `\"GPT-5 notes"`) |
| `\a\b\c\d` | A › B › C (folders go 3 levels deep; the box warns that the extra level is dropped) |

- A path must start the line or follow a space, so links and Windows paths (`C:\Users`) are never read as folders.
- An all-lowercase name gets capitals (`robotics` → Robotics). A name with capitals is kept as typed (`\AI`, `\iOS`).
- Names are matched ignoring case, spaces, hyphens and underscores, so `\open-models` finds an existing "Open Models".
- Matching starts at the top level: `\robotics\papers` looks for Papers *inside* Robotics. A Papers folder somewhere else isn't used.
- Any missing folder along the path is created when you click **Add**. The review tray shows it as "+ New: Robotics › Papers", tagged "your folder".
- The path is removed from the saved text, so it never ends up in an item's notes.
- Forward slashes work too (`/robotics/papers`), but only where they can't be ordinary text: on a line by itself, after a link, or after words like "put the following under". Elsewhere `/etc/hosts` or `AI/ML` stays text.

### What a path applies to

| Where you write it | What goes there |
|---|---|
| On a line with a link or note: `https://… \robotics` | Just that item |
| On a line by itself | Every line below it, until the next path line |
| After words that only say where things go: `Put the following under \robotics\papers`, `Save these in \cooking:`, `Folder: \reading` | The same as a line by itself. The words are dropped, not saved as a note |
| As the first line of the paste | Everything pasted (the same rule as above) |

So one paste can fill several folders:

```
\robotics\papers
https://arxiv.org/abs/…
https://arxiv.org/abs/…
\cooking
https://pizza.example/…
```

- An item never spans two path sections. If the AI groups lines across a path line, the group is split there.
- A path you write always wins over the AI's choice and the "same site as before" rule. An item whose links are all already saved is still flagged and left unchecked, so it isn't saved twice by accident.
- No AI call is made when there's nothing to group: a single line with a path, or a list of bare links that each have a path, are already saved, or come from a site you always file in one place.
- When a dump is too big for one round, the text left in the box gets its section's path written again at the top.

### Picking a folder while you type

Typing `\` in the box lists your folders (up to six), narrowing as you type: `\rob` shows Robotics and Robotics › Papers. ↑/↓ choose, **Tab** or **Enter** completes it as a path, **Esc** closes the list. Picking from the list avoids typos that would create a near-duplicate folder.

Paths also work in instructions ("move all arxiv links to `\robotics\papers`") and in every topic name box: **+ New topic**, **+ New topic…** in the review tray, and **+ Subfolder**. In those boxes spaces are fine, so `Robotics › Papers` and `Robotics\Papers` work too.

### Arranging folders

- **Drag the ⋮⋮ handle**:
  - up or down to reorder among folders with the same parent;
  - **right** to put the folder inside the one above it;
  - **left** to take it out of its parent (it lands right below the parent).
  
  While dragging, a tag on the card says what will happen ("→ into Robotics", "← out to top level"), and the target folder is outlined.
- **Keyboard**: focus the handle; ↑/↓ reorder, → puts it inside the folder above, ← takes it out.
- **Topic ⋯ menu**: **+ Subfolder**, and **Move into…**, which lists every folder it can go into, plus **Top level**. A folder moves with everything inside it. A move that would pass 3 levels, or put a folder inside itself, is refused.
- **Display**: a folder shows its own items first, then its subfolders as smaller nested cards that open and close on their own. The header counts include everything inside. Subfolders take their top folder's color.
- **Deleting** a folder that has subfolders offers two choices:
  - **Delete everything**: the folder, its subfolders and all their items.
  - **Delete only this folder**: its items and subfolders move up into its parent. At the top level its own items are deleted, since there's nowhere above to keep them, and its subfolders become top-level topics.
- **Item ⋯ → Move to**, the review tray and Up next show full paths ("Robotics › Papers").
- **Data**: each topic has an optional `parentId`, and its order is among its siblings. Older data simply has no parents, so nothing needs migrating. Export/Import keep the tree; **Merge** matches folders by name *and* place.

---

## Backups, export and import

All three are in **Settings → Backup**:

- **Choose backup folder.** Automatic backups go to that folder (Chrome, Edge, Brave).
- **Back up now** or **Reconnect folder.** Reconnecting is needed after a browser restart, because browsers ask for folder access again.
- **Export JSON** downloads `stacks-YYYY-MM-DD.json`.
- **Import JSON** either **adds to** your lists or **replaces** them.
  - When adding: topics with the same name are merged, and items with the same link are skipped.

The backup format is `{ app: "stacks", version: 1, exportedAt, topics: [...], items: [...] }`.

---

## Configuration

Set these environment variables in `docker-compose.yml`:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port inside the container. Change the left side of `ports:` to use another port on your machine. |
| `PREVIEW_RATE_LIMIT` | `60` | Link previews one client may request per minute. |
| `ALLOW_PRIVATE_PREVIEWS` | `false` | `true` allows previews of pages on private networks (e.g. a wiki on your NAS) and non-standard ports. Leave `false` on any public server. |
| `TRUST_PROXY` | `false` | `true` when behind a reverse proxy, so rate limits use the real client address. |
| `LOG_LEVEL` | `info` | Fastify log level. Request logging is always off. |

---

## Hosting on a server

Stacks runs the same on a cloud server, and the data still stays in each visitor's browser. Two requirements:

1. **Use HTTPS.** Browsers only allow persistent storage and folder backups in a secure context: `https://`, or `localhost` on your own machine. Opening Stacks over plain `http://` on a LAN IP works, but without folder backups.
2. **Put it behind a reverse proxy** and set `TRUST_PROXY: "true"`.

Example with Caddy, which gets certificates automatically:

```caddy
stacks.example.com {
    reverse_proxy localhost:8080
}
```

Each visitor uses their own API key and their own browser storage, so one deployment can serve several people without them seeing each other's data and without you paying for their AI use.

---

## Security and privacy

- **Content-Security-Policy**: scripts only from the app itself. Network calls are only allowed to the app, `api.anthropic.com` and `api.openai.com`. Fonts are bundled, so there are no calls to Google Fonts. No framing.
- **API keys in the browser**: anything with access to the page could read them. That's why the CSP blocks third-party scripts and Stacks loads none. You can turn off "Remember keys" or use **Forget key** at any time. Give the key its own spend limit at the provider.
- **SSRF protection** in `/api/preview`:
  - Only `http`/`https` links on standard ports, with no credentials in the URL.
  - Every DNS answer is checked at connection time, so loopback, private, link-local, cloud-metadata (`169.254.169.254`) and other reserved addresses are refused, even when a public hostname points at them.
  - Each redirect is checked again (at most 4).
  - Responses are capped at 1.5 MB and requests time out after 8 seconds.
- **No request logs.** The server doesn't log the links you preview.
- **Thumbnails** load directly from the sites they belong to, with `referrerPolicy="no-referrer"`. Those sites can see that an image was requested.
- **Response headers**: `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a restrictive `Permissions-Policy`.

---

## Design

- **Concept.** A personal library under a night sky. The background is a slowly drifting constellation of connected points, standing for ideas linking up, over soft indigo and marigold glows. Every finished item lights a gold star. Panels are frosted glass so the sky shows through.
- **Layout.** Two columns on desktop. On the left are the smart input box and the ranked topics; on the right, a sticky **Up next** column. Token usage lives at the end of Settings to keep the main page calm. On phones it becomes one column with Up next first, with a 16px side gutter and no sideways scrolling.
- **Color tokens.** Defined in `src/styles.css`, with light and dark sets:
  - neutrals tinted toward the accent
  - an indigo accent (`--accent`) for actions
  - marigold (`--mark`) for priority, Up next and stars
  - green (`--good`) for done
  - orange (`--warn`) for "untouched" warnings
- **Type.**
  - Bricolage Grotesque for headings and topic names.
  - IBM Plex Sans for text.
  - IBM Plex Mono for data such as sources, durations, tags and counts.
  - The fonts are self-hosted from `@fontsource`.
- **Priority you can see.** Rank badges: #1 is solid marigold and #2–3 are pale marigold. A green progress bar per topic, and "untouched N days" in orange.
- **Accessibility.**
  - Visible focus rings and labelled controls.
  - Keyboard reordering with arrow keys on the handle, `/` to open the input, `Ctrl/⌘ + Enter` to submit, `Esc` to close Settings.
  - With reduced motion on, the sky stays still.

---

## Development

### With Docker only (no Node on your machine)

```bash
# Dev server with hot reload: web on :5173, API on :8787 inside the container
docker run --rm -it -p 5173:5173 -e VITE_DEV_HOST=0.0.0.0 \
  -v "$PWD":/app -v stacks_nm:/app/node_modules -w /app node:22-alpine \
  sh -c "npm i -g npm@11.21.1 && npm ci && npm run dev"

# Tests and type checks
docker run --rm -v "$PWD":/app -v stacks_nm:/app/node_modules -w /app node:22-alpine \
  sh -c "npm i -g npm@11.21.1 && npm ci && npm run typecheck && npm test"
```

`stacks_nm` is a Docker volume for `node_modules`, so Linux binaries don't end up in your project folder. Remove it with `docker volume rm stacks_nm`.

### With Node 22+ installed

```bash
npm install      # npm 11 recommended; npm 10 has a resolver bug with this tree
npm run dev      # http://localhost:5173 (API proxied to :8787)
npm test         # Vitest: parsing, URLs, scoring, preview parsing, SSRF guards
npm run build    # dist/web (static app) + dist/server (Node server)
npm start        # serves dist on :8080
```

---

## Project structure

```
stacks/
├─ Dockerfile, docker-compose.yml   two-stage build: compile + test, then a small runtime image
├─ index.html, vite.config.ts       Vite entry and config (dev proxy /api → :8787)
├─ server/                          Fastify server (Node 22, ESM)
│  ├─ index.ts                      static files, CSP and security headers, /api/health, /api/preview
│  ├─ preview.ts                    oEmbed (YouTube, Vimeo) and Open Graph / <meta> parsing
│  ├─ net.ts                        safe fetch: URL checks, DNS-time private-address blocking, redirects, limits
│  └─ server.test.ts
└─ src/                             React 19 + TypeScript
   ├─ App.tsx, main.tsx, styles.css
   ├─ db.ts                         Dexie (IndexedDB) schema and settings helpers
   ├─ store.ts                      every write: topics, items, ordering, examples (triggers backup)
   ├─ ingest.ts                     text → numbered lines → previews (short links resolved) → AI grouping → review drafts
   ├─ settings.ts                   provider, models, daily limit, API key storage
   ├─ ai/
   │  ├─ call.ts                    key and budget checks, lazy-loaded adapters, usage tracking
   │  ├─ anthropic.ts, openai.ts    provider adapters (structured JSON output, error mapping)
   │  ├─ group.ts                   grouping prompt and schema: lines → items, titles, main link, topic
   │  ├─ place.ts                   one-item prompt and schema: title, folder, 2 other folders, item to add to
   │  ├─ interpret.ts               instruction prompt, schema, resolving refs to real items/topics
   │  └─ actions.ts                 describe and apply instruction actions
   ├─ lib/                          parse (incl. \ paths), tree (folders), url, scoring, preview client, backup, usage, time, reminders
   └─ components/                   Header, Composer, ReviewTray, InstructionTray, TopicList, TopicCard,
                                    ItemRow, Thumb, UpNext, UsagePanel, SettingsModal, AboutPage, Sky, Spark
```

---

## Decision log

These are the choices made while planning Stacks, and why.

| Topic | Decision | Why |
|---|---|---|
| Storage | Browser IndexedDB as the source of truth, plus an optional backup folder and Export/Import | "Nothing in the cloud", even when the app is hosted in the cloud. |
| Server role | Stateless: serve the app and fetch link previews | Browsers can't read other sites (CORS). Nothing to store means nothing to leak. |
| AI | Cloud API now. Local Ollama deferred | Ollama depends on each machine's compute. The adapter design leaves room for it. |
| Who pays | Each user brings their own API key, stored in their browser | Nobody can run up the host's bill. No server-side quotas or accounts needed. |
| Subscriptions | Not supported | Claude and ChatGPT subscriptions don't cover third-party apps; reusing their tokens breaks the providers' terms. |
| Providers | Claude and OpenAI behind one interface | The shared interface costs the same either way, and a second adapter is small. |
| Spend limits | Provider-side limits are the user's job; the app reminds them | It's the only true hard cap. |
| Out of budget or no key | Ask for a key; no keyword fallback | You preferred an explicit prompt over silently worse sorting. |
| Review before saving | AI suggestions go to a review tray; instructions show a change list before applying | Bad guesses never pollute your lists. |
| Topic ordering | Drag handle only (the up/down arrow buttons were removed) | Cleaner cards. Keyboard users still have arrow keys on the handle. |
| Input box | Collapsible to one line, remembered, `/` to reopen | Topics are visible from the top. |
| Choosing a folder | `\robotics\papers` in the text; hyphens/underscores or quotes for spaces | `/` would clash with links. Paths without spaces stay unambiguous inside a sentence; quotes cover exact names. |
| Path scope | On a line: that item. On its own line: everything below until the next path | One paste can fill several folders. |
| Minimum depth | Sorting files at 2 levels or more; a 1-level `\x` asks the AI for the subfolder | You asked for every item to have an area and a subject. Inbox stays the one 1-level exception. |
| Courses | A course with several lectures is one item with all the lecture links | Matches "one item per post"; lectures stay together. |
| Default mode | The whole paste is one item; "Several things" turns on splitting and is cleared after each add | Most pastes are one thing. The AI only has to find the place, which is cheaper and can't split by mistake. |
| Adding to an item | The AI may suggest an existing item the paste continues, from the latest 5 per folder; shown ticked in the tray | A new lecture belongs with its course. The AI must match the course or series name, not just the kind of item or the field. |
| Folder depth | 3 levels at most | Deeper trees get hard to read and to rank. |
| Nesting by drag | Sideways drag: right = into the folder above, left = out | Works with the existing up/down drag, on touch too, without hover timers. **Move into…** covers moves across the tree. |
| Look | Constellation background, gold star per finished item, progress line | You asked for an inspiring background. Progress becomes visible. |

---

## Roadmap

- **Ollama adapter** for fully local AI (a third adapter next to `anthropic.ts` and `openai.ts`).
- **Sync between devices** through a shared folder (merging backup files) or a self-hosted sync server. Data would stay off third-party clouds.
- **Browser extension or bookmarklet**: "Add this page to Stacks".
- **Better video details**: YouTube durations via the Data API (needs a key), and playlists as one item with parts.
- **Time-aware picks**: "I have 20 minutes" filters Up next by length.
- **Undo** for deletes and applied instructions.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Add your … API key" keeps appearing | Open Settings, paste the key, press **Save**. If "Remember keys" is off, the key is forgotten when the tab closes. |
| "did not accept this API key" | The key was revoked or mistyped, or belongs to the other provider. Keys look like `sk-ant-…` for Claude and `sk-…` for OpenAI. |
| "out of credit" | Add credit in the provider's console, or use another key. |
| "only N are left of your daily limit" | Raise **My daily token limit** in Settings, or wait until tomorrow. |
| A link shows no image or description | The site blocks previews or has no Open Graph tags. The item still works; its tile uses the topic's color. |
| Backup says "needs reconnect" | Browsers ask for folder access again after a restart. Click **Reconnect folder** in Settings. |
| No "Choose backup folder" button | Your browser doesn't support it (Safari, Firefox), or the page isn't on `https://` or `localhost`. Use Export. |
| My lists are gone | Check you're on the same address and browser profile as before. Otherwise use Import with your latest backup or export. |
| `npm install` fails with "Cannot read properties of null (reading 'edgesOut')" | That's an npm 10 bug. Use npm 11: `npm i -g npm@11`. |
