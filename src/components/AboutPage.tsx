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
              Only two things ever leave your device, and only when you use them: text you ask the AI to sort goes straight to the AI provider with your own key, and a link's address goes to the Stacks server just
              long enough to fetch its title and image. The Stacks server keeps neither.
            </li>
          </ul>
        </div>
      </section>
      <TryStacks onTry={onTry} />

      <section>
        <h3>How to use it</h3>
        <ol>
          <li>
            <b>Paste anything into the box at the top.</b> One link, a note, or a whole list copied from a notebook. Every link becomes its own item; a paragraph without links stays together as one note. Up to{' '}
            {LIMITS.maxPieces} pieces are sorted at once, and anything beyond that stays in the box for the next round.
          </li>
          <li>
            <b>Check the suggestions.</b> Stacks fetches each link's title and image, then the AI picks a topic for every piece, or suggests a new topic. Nothing is saved until you press Add, and you can change
            any topic first. Links you already saved are spotted and left unchecked.
          </li>
          <li>
            <b>Or type an instruction</b> in the same box, such as “move all pizza links to Cooking”, “mark the Karpathy video done”, “snooze finance for two weeks” or “make Rust my top priority”. Stacks shows the
            exact changes and waits for you to apply them. Click the label above the box to switch between adding items and giving an instruction.
          </li>
          <li>
            <b>Put your topics in order.</b> Drag the ⋮⋮ handle; the top topic is the most important. With a keyboard, focus the handle and use the arrow keys.
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
        <h3>The AI, and what it costs</h3>
        <p>
          Sorting and instructions use Claude (Anthropic) or OpenAI, with your own API key. The key is kept in this browser, and your browser sends requests directly to the provider, so the Stacks server never sees
          it. A Claude or ChatGPT subscription does not include API access; you create an API key in the provider's console and pay per use.
        </p>
        <p>What gets sent: a link's address, title, site and the first part of its description, or a note's text, plus your topic names. Full pages are never sent.</p>
        <ul>
          <li>Each dump is sorted in one request, using a small, fast model by default (Claude Haiku 5.5 or gpt-5-mini). You can pick a bigger model in Settings.</li>
          <li>Links you already saved are never re-sorted, and sites you always file under one topic are sorted without the AI.</li>
          <li>Your personal daily token limit, set in Settings, stops all AI calls for the day once it's reached. The meter on the right shows today's use.</li>
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
