# AI Hub

One shared chat session across every AI you use: Claude, Gemini, Grok, ChatGPT,
DeepSeek, Mistral, Perplexity, Groq, OpenRouter, or any OpenAI-compatible server
(Ollama, LM Studio…). Sign in with Google, link your AIs, start a session, and
pick **who answers each turn**. Every AI reads the same session, including what
the other AIs said, so you can:

- switch to another AI when one runs out of credits or hits a rate limit,
- ask Gemini to check Claude's answer, or Grok to argue with both,
- send with an empty box to have the selected AI respond to the session so far.

## Run it

It's a static site, so no build step. Serve the repo root and open `/hub/`:

```sh
python3 -m http.server 8000   # or: npx serve .
# then visit http://localhost:8000/hub/
```

On GitHub Pages it's served at `https://<user>.github.io/<repo>/hub/`.

## How "linking" an AI works

Consumer subscriptions (Claude Pro/Max, Gemini Advanced, SuperGrok, ChatGPT
Plus) **cannot** be used by third-party apps. No provider offers a "Sign in with
…" that unlocks your chat plan for other apps. So AI Hub links each AI with an
**API key** from that provider's developer console (each card in *Linked AIs*
links to the right page). API usage is billed by the provider, separately from
any subscription.

Your keys are sent only from your browser to the provider you're talking to.
With Google sign-in, keys, sessions and usage counters are also saved to a
private app-data folder in **your** Google Drive, which only this app can see, so
another device you sign in on gets the same setup.

## Choosing by usage limits / credits

- Each AI shows a **budget meter** if you set a monthly token budget for it.
  AI Hub counts the input and output tokens each provider reports. A ★ marks the
  AI with the most budget left.
- **OpenRouter** reports your real remaining credit, which shows as `$x.xx`
  on its button.
- If a provider rejects a turn for limits (429/402), the error says so and you
  can switch to another AI and **↻ Retry** the same turn.

Other providers don't give API keys a way to read the account balance, so for
those the meter tracks your own budget.

## How the shared session is shown to each AI

Every message is stored once, tagged with who wrote it. When you send a turn to
AI *X*, the history is rebuilt from *X*'s point of view:

- *X*'s own earlier replies are `assistant` turns;
- your messages and **other AIs' replies** are `user` turns, labelled
  `[Gemini · gemini-2.5-pro replied]: …`;
- a system prompt tells *X* it's one of several assistants in a shared session.

This keeps the strict user/assistant alternation some APIs require, and it never
hands a model another model's words as if they were its own. See
`buildTranscript` in `js/providers.js`.

## Google sign-in setup (one time)

1. In [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials)
   create an **OAuth client ID**, type **Web application**.
2. Add your site's origin under **Authorized JavaScript origins**, e.g.
   `https://<user>.github.io` and `http://localhost:8000`.
3. Enable the **Google Drive API** on the same project, and add the
   `drive.appdata` scope on the OAuth consent screen.
4. Put the Client ID in `hub/config.js`, or paste it in the app under
   *Google sign-in setup*.

Without it, choose **Use without an account**. Everything then stays in this
browser, and you can sign in with Google later to start syncing.

## CORS

The app calls the providers straight from the browser. Anthropic, Google,
OpenAI, OpenRouter and most others allow that. If one refuses (you'll see
"Could not reach … CORS"), deploy `proxy/cors-worker.js` as a Cloudflare
Worker and set that AI's **Advanced → Base URL** to
`https://<worker>.workers.dev/api.x.ai/v1` (the worker URL followed by the
provider's host and path).

## Files

| Path                   | What                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `js/providers.js`      | Provider catalog, shared-transcript builder, streaming adapters |
| `js/store.js`          | State, usage accounting, merging copies from different devices  |
| `js/google.js`         | Google sign-in and Drive app-data sync                          |
| `js/app.js`            | UI                                                              |
| `js/markdown.js`       | Small, safe Markdown renderer for replies                       |
| `proxy/cors-worker.js` | Optional CORS proxy                                             |
| `test/hub.test.mjs`    | Unit tests: `node --test hub/test/*.test.mjs`                   |

## Android app (APK)

`android/` wraps the same web app in a native Android WebView. The build copies
`hub/`'s files into the APK, so the two never drift apart.

```sh
cd hub/android
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleRelease     # → app/build/outputs/apk/release/app-release.apk
```

Without a `keystore.properties` the release build is signed with the debug
key. To sign with your own key, create `hub/android/keystore.properties` with
`storeFile`, `storePassword`, `keyAlias` and `keyPassword` (it's git-ignored).

In the app:

- Every AI works, as in the browser. All the provider APIs accept requests from the app.
- Google doesn't allow its sign-in inside app WebViews, so data stays on the
  phone. **Export** saves a file and **Import** reads one. Use them to move
  sessions between the phone and the web app.
- The back button closes dialogs, settings and the session list before it
  leaves the app.
