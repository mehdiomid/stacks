import { WEIGHTS } from '../lib/scoring';
import { LIMITS } from '../lib/parse';

function TryStacks({ onTry, label = 'Try Stacks' }: { onTry: () => void; label?: string }) {
  return (
    <div className="try">
      <a className="btn" href="#" onClick={onTry}>
        {label} →
      </a>
    </div>
  );
}

export function AboutPage({ onTry }: { onTry: () => void }) {
  return (
    <article className="about">
      <section>
        <h2>About Stacks</h2>
        <p className="lede">
          Stacks is a home for everything you mean to read or watch: articles, YouTube videos, courses, and quick notes. Paste them in, and each one lands in the right topic. Stacks then reminds you of the things you
          were about to forget.
        </p>
        <div className="local-note">
          <p>
            <b>Your lists stay on your device.</b> Everything you save is kept in this browser's own storage, on this computer. There is no account and no sign-up, and your lists are never uploaded to the Stacks
            server or to any cloud.
          </p>
          <ul>
            <li>No account, no tracking, no analytics.</li>
            <li>Backups go to a folder on your own disk, or to a file you export.</li>
            <li>
              By default, sorting runs on this device: a small model in your browser picks the folder, so nothing you paste is sent anywhere. A link's address goes to the Stacks server just long enough to
              fetch its title and image. Only if you switch to Claude or OpenAI in Settings does the text you sort go to that provider, straight from your browser with your own key. The Stacks server keeps
              nothing.
            </li>
          </ul>
        </div>
      </section>
      <TryStacks onTry={onTry} />

      <section>
        <h3>How to use it</h3>
        <ol>
          <li>
            <b>Paste anything into the box at the top.</b> One link, a note, a whole post, or a course with its lectures. By default everything you paste is saved as one item with all its links, and
            your own words are kept as its notes. Stacks finds the folder, offers two others as quick picks, and when the paste continues something you saved (the next lecture of a course) it offers to add it
            there. For a long list of unrelated things, tick <b>Several things</b>: up to {LIMITS.maxLinks} links are split and sorted at once, and anything beyond that stays in the box for the next round.
          </li>
          <li>
            <b>Check the suggestions.</b> Stacks fetches each link's title and image, then the AI groups the lines into items, gives each a title and picks a topic, or suggests a new one. Nothing is saved until you press Add, and you can change
            any topic first. Links you already saved are spotted and left unchecked.
          </li>
          <li>
            <b>Choose the folder yourself</b> by adding a path like <code>\robotics\papers</code>. On a line with a link it applies to that item; on a line of its own it applies to everything below it. Folders that
            don't exist yet are created, up to 3 levels deep. Write <code>\machine-learning</code> or <code>\"Machine Learning"</code> for names with spaces. Typing <code>\</code> lists your folders.
          </li>
          <li>
            <b>Or type an instruction</b> in the same box, such as “move all pizza links to Cooking”, “mark the Karpathy video done”, “snooze finance for two weeks” or “make Rust my top priority”. Stacks shows the
            exact changes and waits for you to apply them. Click the label above the box to switch between adding items and giving an instruction.
          </li>
          <li>
            <b>Put your topics in order.</b> Drag the ⋮⋮ handle up or down; the top topic is the most important, and a subfolder ranks right after its parent. Drag right to put a topic inside the one above it, left to
            take it out. With a keyboard, focus the handle and use the arrow keys.
          </li>
          <li>
            <b>Check things off.</b> Every finished item lights a gold star in the background.
          </li>
        </ol>
        <p>
          Shortcuts: <code>/</code> opens the input box, <code>Ctrl</code>/<code>⌘</code> + <code>Enter</code> sorts what you typed.
        </p>
      </section>
      <TryStacks onTry={onTry} />

      <section>
        <h3>How “Up next” picks</h3>
        <p>Every unfinished item gets a score from three things, and the panel shows the top four, with at most two from one topic:</p>
        <div className="formula">
          {`score = ${WEIGHTS.priority} × topic priority      (top topic = 1, last ≈ 0)
      + ${WEIGHTS.waiting} × time waiting        (full after 60 days)
      + ${WEIGHTS.neglect} × topic neglect       (full after 30 days with nothing finished)
      + ${WEIGHTS.jitter} × daily variation`}
        </div>
        <p style={{ marginTop: 10 }}>
          The tag on each pick names the reason that counted most. <b>Snooze</b> hides an item for a few days; <b>Not interested</b> keeps it in its list but stops suggesting it. In Settings you can turn on one
          desktop notification a day for your top pick.
        </p>
      </section>
      <TryStacks onTry={onTry} />

      <section>
        <h3>Where your data lives</h3>
        <p>
          Everything you save stays on your device, in this browser's own database (IndexedDB). That works even when Stacks runs on a server in the cloud: the server only hands your browser the app, and never
          receives or stores your lists.
        </p>
        <ul>
          <li>Stacks asks the browser to protect its storage so it isn't cleared when space runs low.</li>
          <li>In Chrome, Edge or Brave you can choose a backup folder in Settings. Stacks writes a JSON copy there after every change, so your lists survive a cleared browser and you can sync or version them.</li>
          <li>Export and Import move your lists between browsers or computers. API keys are never included.</li>
          <li>Your lists belong to one browser on one computer. Use Export/Import, or a synced backup folder, to move them.</li>
        </ul>
      </section>
      <TryStacks onTry={onTry} />

      <section>
        <h3>Sorting on this device</h3>
        <p>
          Out of the box, Stacks sorts with a small model (snowflake-arctic-embed-xs, 23 MB) that runs in your browser. It's downloaded once from your Stacks server and kept in the browser. It chooses the
          folder and two others, and notices when a paste continues something you saved, like the next lecture of a course; you confirm in the tray. When nothing fits well, “+ New folder” opens first.
        </p>
        <p>
          When nothing fits, a second small model (Qwen3-0.6B, 397 MB, downloaded the first time it's needed) proposes a new folder such as “Finance › Investing”. It fills the Folder box, and you can change it before adding. You can turn this off in Settings.
          Splitting a paste into several items, and instructions like “move all pizza links to Cooking”, need Claude or OpenAI.
        </p>
      </section>

      <section>
        <h3>Claude or OpenAI, and what they cost</h3>
        <p>
          If you choose them in Settings, sorting and instructions use Claude (Anthropic) or OpenAI, with your own API key. The key is kept in this browser, and your browser sends requests directly to the provider, so the Stacks server never sees
          it. A Claude or ChatGPT subscription does not include API access; you create an API key in the provider's console and pay per use.
        </p>
        <p>What gets sent: the text you pasted (links replaced by short references), each link's address, site, page title and the first part of its description, plus your folder names and the titles of the latest few items in each. Full pages are never sent.</p>
        <ul>
          <li>Each dump is sorted in one request, using a small, fast model by default (Claude Haiku 5.5 or gpt-5-mini). You can pick a bigger model in Settings.</li>
          <li>Links you already saved are recognized, and a plain list of links from sites you always file under one topic is sorted without the AI.</li>
          <li>Your personal daily token limit, set in Settings, stops all AI calls for the day once it's reached. Settings (in the menu at the top, next to About) shows today's use at the bottom.</li>
          <li>For a hard cap on spending, also set a monthly limit in the Anthropic Console or the OpenAI dashboard.</li>
        </ul>
      </section>
      <TryStacks onTry={onTry} />

      <section>
        <h3>The server's job</h3>
        <p>
          The small server in the Docker container serves this page and fetches link previews (title, description, image), because browsers can't read other sites directly. It stores nothing, doesn't log the links
          it previews, refuses to fetch addresses on private networks, and limits how many previews one visitor can request per minute.
        </p>
        <p>Thumbnails load straight from the sites they belong to, so those sites can see that an image was requested.</p>
      </section>
      <TryStacks onTry={onTry} label="Start adding links" />
    </article>
  );
}
