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
| `trigger.tray`           | Pluck is running on Windows or macOS             | It has a tray icon; a click opens home, its menu has Open Pluck and Quit          |
| `trigger.start`          | Pluck is started, or started again while running | Home opens; a second copy never runs                                              |
| `trigger.cli-menu`       | `pluck menu` is run                              | Same as pressing the hotkey                                                       |
| `trigger.cli-run`        | `pluck run <id>` is run                          | The action runs on the current selection without showing the menu                 |
| `trigger.linux`          | Pluck runs on Linux                              | It registers no hotkey of its own; the window manager binds a key to `pluck menu` |

> Why: Wayland doesn't let apps grab global keys. Hyprland binds them instead (`bind = SUPER, P, exec, pluck menu`).

## Grab

What pluck reads from the app you were in when the hotkey was pressed.

| Rule                     | When                                                                | Then                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `grab.text`              | Text is selected                                                    | The action receives exactly the selected text as plain text                                                             |
| `grab.empty`             | Nothing is selected                                                 | Home opens instead of the menu                                                                                          |
| `grab.context`           | Any grab                                                            | The action also receives the app name and window title                                                                  |
| `grab.url`               | The selection was copied from a browser that reports its source URL | The action also receives that URL                                                                                       |
| `grab.clipboard-restore` | Pluck had to copy the selection through the clipboard               | The clipboard holds what it held before, once the grab is done                                                          |
| `grab.windows`           | Windows                                                             | UI Automation is asked for the selection first; if the app doesn't answer, pluck sends `Ctrl+C` and reads the clipboard |
| `grab.macos`             | macOS                                                               | The Accessibility API is asked first; if the app doesn't answer, pluck sends `Cmd+C`                                    |
| `grab.linux`             | Linux (Wayland)                                                     | The primary selection is read; the clipboard is never touched                                                           |

## Menu

| Rule                | When                                                          | Then                                                                                                                  |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `menu.open`         | The hotkey is pressed                                         | The menu opens at the cursor, kept fully on screen, with the first action highlighted                                 |
| `menu.fast`         | The hotkey is pressed                                         | The menu is visible within 100 ms                                                                                     |
| `menu.preview`      | The menu is open                                              | A one-line preview of the selected text sits above the actions                                                        |
| `menu.accelerator`  | The menu is open and the key assigned to an action is pressed | That action runs                                                                                                      |
| `menu.filter`       | A key without an assigned action is typed                     | The list narrows to actions whose name matches the typed text; accelerators stop applying until the filter is cleared |
| `menu.run`          | `Enter`, or a click on an action                              | The highlighted or clicked action runs                                                                                |
| `menu.close`        | `Esc`, or focus moves to another window                       | The menu closes and nothing runs                                                                                      |
| `menu.focus-return` | The menu closes                                               | Focus returns to the app that was active before                                                                       |

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

| Rule                    | When                                            | Then                                                                                                                                         |
| ----------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `action.order`          | The menu opens                                  | Actions appear in the order they are listed in the config                                                                                    |
| `action.defaults`       | Pluck starts and there is no `pluck.toml`       | It writes one with sample actions and their scripts                                                                                          |
| `action.run`            | An action runs                                  | Its `run` command runs through the platform shell, with relative paths resolved against the config folder                                    |
| `action.stdin`          | An action runs                                  | The selected text is written to the script's stdin                                                                                           |
| `action.env`            | An action runs                                  | The script gets `PLUCK_APP`, `PLUCK_TITLE`, `PLUCK_URL` when known, and `PLUCK_TEXT` unless the text is too long for an environment variable |
| `action.failure`        | The script exits non-zero                       | Pluck shows its stderr, or the exit code if stderr is empty                                                                                  |
| `action.config-invalid` | The config can't be read or an entry is invalid | The menu shows one line naming the file and the problem; valid entries still work                                                            |
| `action.config-reload`  | The config file changes                         | The next menu shows the change without restarting pluck                                                                                      |

## Output

Each action's `output` says what happens with the script's stdout.

| Rule             | When                 | Then                                                                                                                           |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `output.show`    | `output = "show"`    | A small panel opens at the menu's position and streams stdout as it arrives; `Esc` closes it                                   |
| `output.copy`    | `output = "copy"`    | Stdout is put on the clipboard and a short confirmation appears                                                                |
| `output.notify`  | `output = "notify"`  | The menu closes at once, the script runs in the background, and its first line of stdout (or "Done") appears as a notification |
| `output.replace` | `output = "replace"` | Stdout replaces the selection in the original app                                                                              |
| `output.default` | No `output` is given | It is `notify`                                                                                                                 |

## Home

A normal window with two tabs, Settings and Scripts. Closing it hides it; pluck keeps running in the tray.

| Rule                    | When                                              | Then                                                                                                              |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `home.tabs`             | Home opens                                        | It shows the Settings tab; Scripts is one click away                                                              |
| `settings.hotkey`       | The hotkey button is clicked and keys are pressed | The new hotkey takes effect immediately and is saved; `Esc` keeps the old one                                     |
| `settings.hotkey-taken` | The pressed hotkey can't be registered            | The old hotkey stays and a line says the new one is taken                                                         |
| `scripts.list`          | The Scripts tab is open                           | It lists the actions from `pluck.toml` in menu order with their key, command and output, plus any config problems |
| `scripts.reload`        | Home gets focus                                   | The list is read from `pluck.toml` again                                                                          |
| `scripts.edit`          | "Edit pluck.toml" or "Open folder"                | The file opens in its default app, or the config folder in the file manager                                       |
| `settings.actions`      | The Scripts tab is open                           | Actions can be added, edited, reordered and removed, and the changes are written to `pluck.toml`                  |

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

| Term              | Meaning                                                                      |
| ----------------- | ---------------------------------------------------------------------------- |
| Action            | One menu entry: a name, an optional key, a command to run and an output mode |
| Selection         | The text highlighted in the app you were in when pluck was triggered         |
| Config folder     | Where `pluck.toml` and your scripts live                                     |
| Primary selection | On Linux, the text most recently highlighted, readable without copying       |
