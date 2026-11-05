# pluck specification

Pluck sends text you select in any app to your own scripts. Select text, press the hotkey, pick an action from a small menu at the cursor, and pluck runs the script with the text and shows, copies or quietly handles the result. Actions are plain entries in a config file, so anything a script can do (translate, explain, bookmark) is an action.

This spec says what the app does. It doesn't say how it is built, what is proven where, or why every decision was made; that lives in docs/.

## Reading a rule

Behavior is written as rules in tables:

| Rule        | When                  | Then                         |
| ----------- | --------------------- | ---------------------------- |
| `menu.open` | The hotkey is pressed | The menu opens at the cursor |

- **Rule** is a stable slug, `area.behavior`. Tests put it in their title (`test("menu.open: ...")`).
- **When** is the situation or input. **Then** is the observable result, in plain present tense.
- **MUST** appears only where a rule could be misread as optional.
- A `> Why:` line follows a rule only when the reason isn't obvious.

Split into files by area (`spec/menu.md`, `spec/action.md`) once this one gets long, and link them here.

## Trigger

| Rule                     | When                                             | Then                                                                              |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `trigger.hotkey`         | The hotkey is pressed in any app                 | Pluck grabs the selection and opens the menu                                      |
| `trigger.hotkey-default` | No hotkey has been chosen                        | The hotkey is `Ctrl+Alt+Space` (`Cmd+Option+Space` on macOS)                      |
| `trigger.tray`           | Pluck is running on Windows or macOS             | It has a tray icon; a click opens home, its menu has Open Pluck, Agents and Quit  |
| `trigger.start`          | Pluck is started, or started again while running | Home opens; a second copy never runs                                              |
| `trigger.login`          | Start Pluck when you log in is checked           | Pluck starts with the system, into the tray                                       |
| `trigger.cli-menu`       | `pluck menu` is run                              | Same as pressing the hotkey                                                       |
| `trigger.cli-run`        | `pluck run <id>` is run                          | The action runs on the current selection without showing the menu                 |
| `trigger.linux`          | Pluck runs on Linux                              | It registers no hotkey of its own; the window manager binds a key to `pluck menu` |

> Why: Wayland doesn't let apps grab global keys. Hyprland binds them instead (`bind = SUPER, P, exec, pluck menu`).

## Grab

What pluck reads from the app you were in when the hotkey was pressed.

| Rule                     | When                                                                          | Then                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `grab.text`              | Text is selected                                                              | The action receives exactly the selected text as plain text                                                                              |
| `grab.empty`             | Nothing is selected                                                           | The menu opens on the clipboard's text and says so; with no text there either, home opens                                                |
| `grab.context`           | Any grab                                                                      | The action also receives the app name and window title                                                                                   |
| `grab.url`               | The selection was copied from a browser that reports its web address          | The action also receives that address; other source addresses, like the files of apps built on Electron, are left out                    |
| `grab.browser-url`       | Windows, nothing selected in a browser, and the setting to grab its URL is on | Pluck copies the address bar with `Ctrl+L`, `Ctrl+C` and `Esc`, and actions receive it like `grab.url`; the clipboard's text is put back |
| `grab.clipboard-restore` | Pluck had to copy the selection through the clipboard                         | The clipboard holds what it held before, once the grab is done                                                                           |
| `grab.windows`           | Windows                                                                       | UI Automation is asked for the selection first; if the app doesn't answer, pluck sends `Ctrl+C` and reads the clipboard                  |
| `grab.macos`             | macOS                                                                         | The Accessibility API is asked first; if the app doesn't answer, pluck sends `Cmd+C`                                                     |
| `grab.linux`             | Linux (Wayland)                                                               | The primary selection is read; the clipboard is never touched                                                                            |

## Menu

| Rule                | When                                                                      | Then                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu.open`         | The hotkey is pressed                                                     | The menu opens at the cursor, kept fully on screen, with the first action highlighted                                                                     |
| `menu.fast`         | The hotkey is pressed                                                     | The menu is visible within 100 ms                                                                                                                         |
| `menu.preview`      | The menu is open                                                          | A one-line preview of the selected text sits above the actions                                                                                            |
| `menu.icons`        | The menu is open                                                          | Each action has an icon for what it does: a sparkle for prompts and Ask, else what happens with the output; the highlighted one is in the theme's primary |
| `menu.arrive`       | The menu opens                                                            | Its rows arrive one after another within 200 ms, or at once with reduced motion; moving the highlight is instant                                          |
| `menu.accelerator`  | The menu is open and the key assigned to an action is pressed             | That action runs                                                                                                                                          |
| `menu.filter`       | A key without an assigned action is typed, or Space first                 | The list narrows to actions whose name matches the typed text; accelerators stop applying until the filter is cleared                                     |
| `menu.ask`          | Text is typed                                                             | The last row is "Ask <text>"; picking it sends the question, with the selected text and where it came from, to an agent session                           |
| `menu.continue`     | The menu has agent actions or a question, and an agent session ran before | A line says agents start a new session, and how long ago the last session was active; `Tab` switches to continuing that session instead                   |
| `menu.run`          | `Enter`, or a click on an action                                          | The highlighted or clicked action runs                                                                                                                    |
| `menu.pick`         | An action or question is picked                                           | Its row and key light up in the theme's primary while the other rows dim, and it runs 160 ms later                                                        |
| `menu.close`        | `Esc`, or focus moves to another window                                   | The menu closes and nothing runs                                                                                                                          |
| `menu.focus-return` | The menu closes                                                           | Focus returns to the app that was active before                                                                                                           |

> Why: a single key runs its action, so a question that starts with one would run it; a leading Space makes it a question. Continuing a session is cheapest within a few minutes of its last run, while the model provider still caches its prompt, so the menu shows that time.

## Action

Actions are listed in `pluck.toml` in pluck's config folder (`%APPDATA%\pluck` on Windows, `~/Library/Application Support/pluck` on macOS, `~/.config/pluck` on Linux).

```toml
[[action]]
id = "explain"
name = "Explain"
key = "e"
run = "scripts/explain.ps1"
output = "show"
```

| Rule                    | When                                                 | Then                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action.order`          | The menu opens                                       | Actions appear in the order they are listed in the config                                                                                                                             |
| `action.defaults`       | Pluck starts and there is no `pluck.toml`            | It writes one with sample actions and their scripts: PowerShell on Windows, bash on macOS and Linux                                                                                   |
| `action.run`            | An action runs                                       | Its `run` command runs through the platform shell (`cmd.exe`, WSL's bash when Run in WSL is checked, `sh` on macOS and Linux), with relative paths resolved against the config folder |
| `action.stdin`          | An action runs                                       | The selected text is written to the script's stdin                                                                                                                                    |
| `action.env`            | An action runs                                       | The script gets `PLUCK_APP`, `PLUCK_TITLE`, `PLUCK_URL` when known, and `PLUCK_TEXT` unless the text is too long for an environment variable                                          |
| `action.failure`        | The script exits non-zero                            | Pluck shows its stderr, or the exit code if stderr is empty                                                                                                                           |
| `action.config-invalid` | The config can't be read or an entry is invalid      | The menu shows one line naming the file and the problem; valid entries still work                                                                                                     |
| `action.agent`          | An action has `agent = "<prompt>"` instead of `run`  | Picking it closes the menu and opens the agents window on a new session, or the last one (`menu.continue`), sent the prompt followed by the text and where it came from               |
| `action.one-off`        | An agent action has an `output` other than `session` | The agent replies once to the prompt and text, without a session, and the reply goes where `output` says; a failure shows with the model that failed                                  |
| `action.model`          | An agent action has `model` or `thinking`            | A session or reply it starts uses them instead of the ones in Settings; a `model` without `thinking` leaves the level to the harness                                                  |
| `action.config-reload`  | The config file changes                              | The next menu shows the change without restarting pluck                                                                                                                               |

## Output

Each action's `output` says what happens with the script's stdout, or the agent's reply for an `agent` action.

| Rule             | When                                      | Then                                                                                                                                                                          |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `output.show`    | `output = "show"`                         | A small panel opens at the menu's position and streams stdout as it arrives, its title shimmering until a check marks it done; `Esc` closes it                                |
| `output.copy`    | `output = "copy"`                         | The menu says the action started and closes; when it's done, the output is put on the clipboard and a short confirmation appears                                              |
| `output.notify`  | `output = "notify"`                       | The menu says the action started, closes, and it runs in the background; the script's first line of stdout, or the agent's whole reply (or "Done"), appears as a notification |
| `output.replace` | `output = "replace"`                      | A panel streams stdout as a preview; `Enter` puts it in place of the selection, or on the clipboard when the text came from there; `Esc` cancels                              |
| `output.session` | `output = "session"` on an `agent` action | It opens an agent session (`action.agent`); on a script it's a config problem                                                                                                 |
| `output.default` | No `output` is given                      | It is `notify` for a script and `session` for an `agent` action; an `agent` action's `interactive = false` means `show`                                                       |

## Home

A normal window with two tabs, Settings and Menu. Closing it hides it; pluck keeps running in the tray.

| Rule                    | When                                              | Then                                                                                                                                                 |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home.tabs`             | Home opens                                        | It shows the Settings tab; Actions is one click away                                                                                                 |
| `settings.login`        | Start Pluck when you log in is clicked            | Pluck starts, or stops starting, with the system                                                                                                     |
| `settings.wsl`          | Run in WSL is checked (Windows only)              | Scripts run in WSL's bash and agents use the Pi installed there, with WSL paths                                                                      |
| `settings.hotkey`       | The hotkey button is clicked and keys are pressed | The new hotkey takes effect immediately and is saved; `Esc` keeps the old one. On Linux the section says how to bind `pluck menu` instead            |
| `settings.hotkey-taken` | The pressed hotkey can't be registered            | The old hotkey stays and a line says the new one is taken                                                                                            |
| `actions-tab.list`      | The Actions tab is open                           | It lists the actions in menu order with their key, icon, and prompt or command, plus any config problems                                             |
| `actions-tab.reload`    | Home gets focus                                   | The list is read from `pluck.toml` again                                                                                                             |
| `actions-tab.files`     | "Edit pluck.toml" or "Open folder"                | The file opens in its default app, or the config folder in the file manager                                                                          |
| `actions-tab.prompt`    | New action is clicked                             | A dialog asks for a name, a key, a prompt the agent gets with the selected text and an output, a session by default; Script switches it to a command |
| `actions-tab.agent`     | A prompt action is edited                         | Model and thinking pickers under the prompt start on Settings' choice and are saved to `pluck.toml`                                                  |
| `actions-tab.key`       | A new action is named                             | Its key follows the first letter of the name no other action uses, until a key is typed; a key in use is refused, naming the action that has it      |
| `actions-tab.edit`      | An action is saved, moved up or down, or deleted  | `pluck.toml` is written at once in menu order, keeping its comments; while an entry in it is invalid nothing is written and the tab says why         |

## Agents

Agent sessions run an agent harness you already have installed, so its models, logins and extensions just work. Pi is the only harness so far. On Windows it runs the Windows install, or the one inside WSL when Run in WSL is checked.

```toml
[[action]]
id = "explain"
name = "Explain"
key = "e"
agent = "Explain this briefly."
```

| Rule                      | When                                                          | Then                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.window`            | Agents is picked in the tray or home, or an agent action runs | The agents window opens on the session; the sessions list on the left starts hidden and one click slides it in or out. Home has an Agents button in its header                                                                                                              |
| `agent.harness`           | A session starts                                              | It runs the harness from Settings in the agent folder, with the chosen model and thinking level, or the harness's own defaults                                                                                                                                              |
| `agent.new`               | New session is selected and a prompt is sent                  | A session starts on that prompt and is added to the list                                                                                                                                                                                                                    |
| `agent.sessions`          | The agents window is open                                     | Sessions pluck started are listed most recently active first, each with how long ago, running ones with a spinner                                                                                                                                                           |
| `agent.quote`             | A session shows a prompt from an agent action                 | The request shows as the message, with the selected text above it under where it came from, open at first, and the page address when known                                                                                                                                  |
| `agent.last-active`       | A session finishes a run                                      | Its time is kept, and the list, its header and the menu say how long ago it was                                                                                                                                                                                             |
| `agent.remove`            | A session's remove button is clicked                          | It stops and leaves the list; the harness keeps its own copy                                                                                                                                                                                                                |
| `agent.reopen`            | A session in the list is picked                               | It shows its history and takes new prompts, also after pluck restarted                                                                                                                                                                                                      |
| `agent.stream`            | The agent works                                               | Its reply streams in, and each tool call shows as a step that is running, done or failed; a provider error shows in the reply with the model that failed                                                                                                                    |
| `agent.links`             | A link in a session is clicked                                | It opens in the default browser                                                                                                                                                                                                                                             |
| `agent.web`               | A session searches the web or reads pages                     | The step names the queries or pages, and shows each site it found or is reading as a chip with the site's icon that opens the page                                                                                                                                          |
| `agent.model`             | A session is open                                             | The model and thinking level Pi runs it with show under the message box                                                                                                                                                                                                     |
| `agent.stop`              | Stop is clicked                                               | The current run is aborted; the session stays open                                                                                                                                                                                                                          |
| `agent.exit`              | The harness can't start or stops                              | The session shows why, and the next prompt starts it again                                                                                                                                                                                                                  |
| `agent.dialogs`           | The harness asks a question through an extension dialog       | The window shows it as a choice, yes or no, or a text field, and sends the answer; closing it cancels                                                                                                                                                                       |
| `settings.agent`          | The Settings tab is open                                      | It has the harness, model, thinking level and folder; changes apply to new sessions                                                                                                                                                                                         |
| `settings.agent-folder`   | Choose… next to the folder is clicked                         | A folder picker opens; with Run in WSL the picked folder is named as WSL sees it, like `/home/me/src`                                                                                                                                                                       |
| `settings.agent-models`   | The Settings tab is open                                      | Pi is asked for its models right away; the list has "Pi default" with the model Pi starts with, then the models in Pi's scope (`enabledModels`), or all its models when it has none                                                                                         |
| `settings.agent-thinking` | The thinking list is opened                                   | It lists the levels the chosen model supports and marks the one Pi starts it with, which follows Pi. Switching models keeps a level picked by hand when the new model supports it, else takes the new model's own. A line below says which model and level new sessions use |

## Updates

| Rule              | When                          | Then                                                                                                   |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `update.check`    | Pluck starts                  | It asks GitHub for the latest release once; a failed check stays silent                                |
| `update.offer`    | A newer release exists        | Home shows a bar with the version and an Update button                                                 |
| `update.install`  | Update is clicked             | The signed installer downloads and runs, and pluck restarts on the new version; a failure offers Retry |
| `install.windows` | Pluck is installed on Windows | One setup exe installs it per user; no MSI                                                             |

## Web prototype

| Rule            | When                                           | Then                                                                                                    |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `web.prototype` | Pluck runs in a plain browser (`pnpm dev:web`) | The menu and home render with sample data, switchable from the header, and actions return canned output |

> Why: UI iteration in a browser is much faster than rebuilding the native app on Windows.

## Glossary

| Term              | Meaning                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Action            | One menu entry: a name, an optional key, a command to run and an output mode, or a prompt for an agent |
| Harness           | An installed agent program pluck drives, such as Pi                                                    |
| Session           | One conversation with the harness, kept by the harness and listed by pluck                             |
| Selection         | The text highlighted in the app you were in when pluck was triggered                                   |
| Config folder     | Where `pluck.toml` and your scripts live                                                               |
| Primary selection | On Linux, the text most recently highlighted, readable without copying                                 |
