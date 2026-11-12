# Changelog

## [0.3.0](https://github.com/Soleone/pluck/compare/v0.2.0...v0.3.0) (2026-11-12)

### Features

* **actions:** Create with agent in the new action dialog opens a session that builds the action from a description ([343a844](https://github.com/Soleone/pluck/commit/343a8445cdc7d66c79c9c6cde7578308cabd6d32))
* **agent:** sessions know they run inside pluck and read a guide in the config folder before creating or changing actions ([e26b70b](https://github.com/Soleone/pluck/commit/e26b70b2707ea6a8035d5e6ef06e908252eed494))

## [0.2.0](https://github.com/Soleone/pluck/compare/v0.1.5...v0.2.0) (2026-11-06)

### Features

* **actions:** a progress output shows a card with Stop while it runs, and notify only shows the result, in place of quiet ([33b0ec9](https://github.com/Soleone/pluck/commit/33b0ec94bcb0de4269aa572afdea4fe505b8351f))
* **actions:** env table passes your own variables to a script, and a Read aloud sample speaks the text with Kokoro or Edge voices ([de018bf](https://github.com/Soleone/pluck/commit/de018bf4786b89de98deafc0bffdfc624f78f72e))
* **actions:** quiet = true runs an action with no card until its result, for actions you start several of ([cb18dd2](https://github.com/Soleone/pluck/commit/cb18dd2621cee8a96739097411f86821201a0ac0))
* **home:** actions and agents sit by the title, settings moves to a gear button, config files behind a ⋯ menu ([f0f2933](https://github.com/Soleone/pluck/commit/f0f2933e577320cffe80f596f4c7dfc91df97d91))
* **home:** agents becomes an icon button beside the theme picker, since it opens its own window ([f5ae75e](https://github.com/Soleone/pluck/commit/f5ae75e38f4732ce151b7b2d66b2e55703bdf004))
* **home:** settings open in a dialog, so Home is just the action list ([955a60f](https://github.com/Soleone/pluck/commit/955a60f063cbf7e67abe4e43e22315941c719821))
* **overlay:** background actions show on cards at the bottom of the screen with a Stop button, in place of system notifications ([f41726a](https://github.com/Soleone/pluck/commit/f41726a4875485a9aa7934caa75083653e9186a4))
* **overlay:** quick actions show only their result, and a notify script's last line is its result, so a script can print status as it goes ([fbd2775](https://github.com/Soleone/pluck/commit/fbd2775ac931a44ea855035d0c4ceacedbb5df9c))

### Bug Fixes

* **overlay:** status icon centers on the card's title line ([ff86a60](https://github.com/Soleone/pluck/commit/ff86a60f16e541f336c48afc1524db489c9341a3))

## [0.1.5](https://github.com/Soleone/pluck/compare/v0.1.4...v0.1.5) (2026-11-06)

### Features

* a hosted browser demo, a real README and showcase.json ([4f447a8](https://github.com/Soleone/pluck/commit/4f447a82632bfded3218b12a7270bc0eec87fcc0))
* **actions:** the action dialog keeps its size between prompt and script, with a menu preview and output tiles ([3c4dfe1](https://github.com/Soleone/pluck/commit/3c4dfe1fb9705db5a7996d769a6e602f762cb375))
* **agents:** sessions can run on Claude Code or Codex besides Pi ([156810e](https://github.com/Soleone/pluck/commit/156810efef3156480a4381d257845106b0e01105))
* color the icon in Gilt's light blue instead of jade ([5c3a0ac](https://github.com/Soleone/pluck/commit/5c3a0ac3b92274740950af825ff4f77c2e8469e0))
* the Esc and Enter hints under a result panel can be clicked ([d41d188](https://github.com/Soleone/pluck/commit/d41d1884688a964bb58ad6d2518e428229b8806c))
* **web:** the demo's corners come from showcase-live-kit, with the animated download button ([926a50f](https://github.com/Soleone/pluck/commit/926a50f22342a1dcc5304376c3fde3a1fb213ee8))
* **web:** the demo's download button sits in the bottom right corner, as in tasks ([144c5db](https://github.com/Soleone/pluck/commit/144c5db4aa58f6c32bf961aac57768ff23643e1f))

### Bug Fixes

* **agents:** the thinking list marks the default level without naming Pi ([c3ab36e](https://github.com/Soleone/pluck/commit/c3ab36eeb714aafdbe76a5a868689d5ac6277480))
* starting at login stays in the tray instead of opening home ([a24b4b3](https://github.com/Soleone/pluck/commit/a24b4b3551529d455ba5f9b05c95158e3abb9097))

## [0.1.4](https://github.com/Soleone/pluck/compare/v0.1.3...v0.1.4) (2026-11-05)

### Features

* color the icon in Gilt's jade green instead of red ([90a1f45](https://github.com/Soleone/pluck/commit/90a1f4543230ab427f8aa8367705cb733fa58e01))
* Home and Agents reopen where they were left, and Home starts big enough for all of Settings ([ca43198](https://github.com/Soleone/pluck/commit/ca43198337e58db991b3b595f777ca9741b9da94))
* pick a theme from Home, next to Agents, and every open window follows it ([5b5b0f9](https://github.com/Soleone/pluck/commit/5b5b0f9658eef851bdd767e16484ad6a7755a365))

## [0.1.3](https://github.com/Soleone/pluck/compare/v0.1.2...v0.1.3) (2026-11-05)

### Bug Fixes

* line the settings checkboxes up with their label, not the label and description ([87b093a](https://github.com/Soleone/pluck/commit/87b093a95c9c2894befbcb1d248ec1491b822cd6))
* open the menu on the browser's URL when the setting grabs it, not on the clipboard ([2bdbd95](https://github.com/Soleone/pluck/commit/2bdbd95e8adfb2602163f8f322a16c44d7298613))

## [0.1.2](https://github.com/Soleone/pluck/compare/v0.1.1...v0.1.2) (2026-11-05)

### Features

* optionally grab the browser's URL when nothing is selected (Windows) ([4282d89](https://github.com/Soleone/pluck/commit/4282d89d8848ea8b5d98f72c243280ed14103298))
* prompts choose an output like scripts: session, panel, replace, copy or notify ([9123032](https://github.com/Soleone/pluck/commit/91230322769cfca2de24d78b0e2c5caa3db2a99b))

### Bug Fixes

* **ci:** check files out with LF on Windows so the release's format check passes ([53ccbac](https://github.com/Soleone/pluck/commit/53ccbacc7d14a7f2c0284a4bbdf40ff28727caa6))
* editing an action survives the window reloading the actions on focus ([8aebf72](https://github.com/Soleone/pluck/commit/8aebf72108f4410adfb76f06e727777590e4e4ab))
* name the active window in agent prompts when the text came from the clipboard ([d7bdbbd](https://github.com/Soleone/pluck/commit/d7bdbbdbf6336f04c11ae4067a8424df2fbc064f))

## 0.1.1 (2026-11-05)

### Features

* add Tauri shell, dev:web and the first spec ([5653f42](https://github.com/Soleone/pluck/commit/5653f4232c68024d52eece8ee3121849d176835c))
* agent sessions in their own window, run by the installed Pi ([d74b4f8](https://github.com/Soleone/pluck/commit/d74b4f86d75e27ce3f1586414953b17e8952918f))
* edit the menu's actions in a Menu tab, give the menu icons, keycaps and pick feedback, apply the Gilt theme ([ba9f0cf](https://github.com/Soleone/pluck/commit/ba9f0cf218ee569a73140216560039b272cdba16))
* fall back to clipboard text when nothing is selected ([897ee86](https://github.com/Soleone/pluck/commit/897ee86f15e79dd59689ea54d9898d20294eaedc))
* home window with hotkey settings and scripts, app icon, updater and NSIS-only Windows installer ([57518df](https://github.com/Soleone/pluck/commit/57518dfba7f0ca21aad256a91a622ec73d8f19ca))
* hotkey menu that sends the selection to scripts (Windows) ([16f82e8](https://github.com/Soleone/pluck/commit/16f82e8864de3039f6bafcc9a1535f99969d7731))
* per-action model and thinking level, and one-off prompt replies shown in the menu ([7b0ee39](https://github.com/Soleone/pluck/commit/7b0ee39bcd8db26f1dc86dfd05246f1ae26dbaa5))
* replace, ask, continue sessions, start at login, page URLs, macOS and Linux prep ([458e699](https://github.com/Soleone/pluck/commit/458e699802cb233d1ccbe8cb6f8649d9ef8d9cd8))
* shared model picker and step titles, model pill under the composer, ruby single-star icon ([6c6866f](https://github.com/Soleone/pluck/commit/6c6866ff134e3f92a2f820f4e7b2cb143ca537a3))
* show selections as quotes in sessions and keep only web page addresses ([a572d07](https://github.com/Soleone/pluck/commit/a572d0751487d378a59654e9667d5edc032c6982))
* show the session's model and thinking level in the agents header ([9b84011](https://github.com/Soleone/pluck/commit/9b84011f112c405230e7b018370c3d15a0dd12bd))
* show web search queries and the sites found as favicon chips ([4d6c265](https://github.com/Soleone/pluck/commit/4d6c265362914c6fc2e15933c2dcd57ed229fa66))
* slide the sessions list in and out, Agents button in the home header ([866b4a8](https://github.com/Soleone/pluck/commit/866b4a8478a3e49c4bb345956e9698be56e23c93))
* sparkle app icon and name the model when Pi fails ([0f4012a](https://github.com/Soleone/pluck/commit/0f4012abc26c114f89cc4dfdabd99f37517f3413))

### Bug Fixes

* ask for the release bump instead of taking the recommended one ([92d3118](https://github.com/Soleone/pluck/commit/92d31181170436366f1406b2de26a54388a71a21))
* brighter Gilt red app icon ([eb53739](https://github.com/Soleone/pluck/commit/eb53739fd03cfeb79d2d9d80a3d3d1f8ea070352))
* let release-it bump the version despite the pnpm devEngines pin ([10df889](https://github.com/Soleone/pluck/commit/10df8896ec95e8167b878a1674822585dc38b4ba))
* open session links in the browser and rebuild the exe icon when icons change ([90ca4c2](https://github.com/Soleone/pluck/commit/90ca4c2ebdd21d44c8ce9ce53cde103165f9a949))
