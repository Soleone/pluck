# Writing Pluck actions

Pluck rewrites this file whenever an agent session starts, so don't keep notes here.

Pluck shows a small menu at the cursor when the user presses its hotkey with text selected. Each menu entry is an action: a script that gets the text, or a prompt sent to an agent with the text. Actions are the `[[action]]` entries of `pluck.toml` in this folder, shown in file order. Scripts live in `scripts/` here by convention. Pluck reads `pluck.toml` each time the menu opens, so a change needs no restart.

## An action

```toml
[[action]]
id = "count" # stable and unique, lowercase
name = "Count words" # what the menu shows
key = "w" # optional: one key no other action uses, runs it from the menu
run = 'bash scripts/count.sh' # a script action: a command line
output = "show"
```

| Field               | Meaning                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `run`               | A command line, run in this folder. Use single quotes so backslashes stay as they are                      |
| `agent`             | Instead of `run`: a prompt, sent to the agent followed by the text and where it came from                  |
| `output`            | What happens with the script's stdout or the agent's reply, see below                                      |
| `env`               | Script actions: extra variables, `env = { VOICE = "af_heart" }`. Put a script's settings here              |
| `model`, `thinking` | Agent actions: the model and thinking level to use instead of the ones in Settings. Leave out unless asked |

An entry needs `id`, `name` and one of `run` or `agent`. An entry that breaks a rule is left out of the menu, which then shows one line naming the problem, as does Pluck's home window.

## Output

| `output`   | What the user sees                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `notify`   | Runs in the background. When done, a card shows the script's last line of stdout, so end with a result line |
| `progress` | Like `notify`, with a card while it runs showing the latest line and a Stop button. For long runs           |
| `show`     | A panel at the menu streams stdout as it arrives                                                            |
| `copy`     | stdout goes to the clipboard                                                                                |
| `replace`  | A panel previews stdout, and Enter puts it in place of the selection. Print only the new text               |
| `session`  | Agent actions only: opens an agent session on the prompt                                                    |

Left out, it is `notify` for a script and `session` for an agent action. With `agent`, the other outputs get one reply from the agent with no session, and `notify` shows the whole reply.

## What a script gets

- The selected text on stdin, and in `PLUCK_TEXT` unless it is longer than about 32,000 characters. Read stdin when the text can be long.
- `PLUCK_APP` and `PLUCK_TITLE`: the app and window the text came from.
- `PLUCK_URL`: the page's address, only when the text came from a browser that reports it.
- The action's `env` variables.
- This folder as its working folder, so relative paths point here.

A script that exits non-zero fails the action, and the user sees its stderr, or the exit code when stderr is empty. Write a short, readable reason to stderr.

## Which shell runs `run`

You were told which one applies when the session started.

- **sh** (macOS and Linux): `run = 'bash scripts/name.sh'`. A script with dependencies can be Python with inline metadata, `run = 'uv run --script scripts/name.py'`.
- **cmd.exe** (Windows): `run = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/name.ps1'`. Start a PowerShell script with `[Console]::OutputEncoding = [Text.Encoding]::UTF8` so its output isn't garbled.
- **WSL's bash** (Windows with Run in WSL): like sh. This folder is on the Windows side, so paths start with `/mnt/c/`. Windows programs are reachable, for example `clip.exe` or `explorer.exe`.

## Steps

1. Read `pluck.toml` to see the ids and keys already in use and how the existing actions are written.
2. Write the script in `scripts/`. Start it with a comment saying what it does.
3. Try it from this folder before adding it, with the text on stdin and in the variables, for example `printf 'some text' | PLUCK_TEXT='some text' PLUCK_APP=Test PLUCK_TITLE=Test bash scripts/name.sh`.
4. Add the `[[action]]` entry where it fits in the menu's order. Keep the comments and the other entries as they are.
5. Tell the user the action's name and key, and that it is in the menu the next time it opens.
