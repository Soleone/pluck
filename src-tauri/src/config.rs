use serde::{Deserialize, Serialize};
use crate::agent::Harness;
use std::{collections::BTreeMap, fs, io, path::Path};
use toml_edit::{value, ArrayOfTables, DocumentMut, Item, Table};

const DEFAULT_HOTKEY: &str = if cfg!(target_os = "macos") { "Super+Alt+Space" } else { "Ctrl+Alt+Space" };
/// Written by the settings screen, unlike pluck.toml which is the user's.
const SETTINGS: &str = "settings.json";

/// Written on first run so the menu has something to try.
#[cfg(windows)]
const DEFAULT_FILES: [(&str, &str); 7] = [
  ("pluck.toml", include_str!("../defaults/windows/pluck.toml")),
  ("scripts/translate.ps1", include_str!("../defaults/windows/scripts/translate.ps1")),
  ("scripts/search.ps1", include_str!("../defaults/windows/scripts/search.ps1")),
  ("scripts/bookmark.ps1", include_str!("../defaults/windows/scripts/bookmark.ps1")),
  ("scripts/count.ps1", include_str!("../defaults/windows/scripts/count.ps1")),
  ("scripts/upper.ps1", include_str!("../defaults/windows/scripts/upper.ps1")),
  ("scripts/read.py", include_str!("../defaults/read.py")),
];
#[cfg(not(windows))]
const DEFAULT_FILES: [(&str, &str); 7] = [
  ("pluck.toml", include_str!("../defaults/unix/pluck.toml")),
  ("scripts/translate.sh", include_str!("../defaults/unix/scripts/translate.sh")),
  ("scripts/search.sh", include_str!("../defaults/unix/scripts/search.sh")),
  ("scripts/bookmark.sh", include_str!("../defaults/unix/scripts/bookmark.sh")),
  ("scripts/count.sh", include_str!("../defaults/unix/scripts/count.sh")),
  ("scripts/upper.sh", include_str!("../defaults/unix/scripts/upper.sh")),
  ("scripts/read.py", include_str!("../defaults/read.py")),
];

/// What happens with a script's stdout or an agent's reply. `Session` is for prompts only: they
/// open an agent session instead of getting one reply.
#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Output {
  Session,
  Show,
  Copy,
  Notify,
  Replace,
}

impl Output {
  fn name(self) -> &'static str {
    match self {
      Output::Session => "session",
      Output::Show => "show",
      Output::Copy => "copy",
      Output::Notify => "notify",
      Output::Replace => "replace",
    }
  }
}

/// Runs `run` as a script, or with `agent` set, sends that prompt to the agent instead.
#[derive(Clone, Serialize, Deserialize)]
pub struct Action {
  pub id: String,
  pub name: String,
  pub key: Option<String>,
  #[serde(default)]
  pub run: String,
  pub agent: Option<String>,
  /// Unset, it is `Notify` for scripts and `Session` for prompts.
  #[serde(default = "notify")]
  pub output: Output,
  /// Unset model and thinking use the agent settings.
  pub model: Option<String>,
  pub thinking: Option<String>,
  /// Extra environment variables for the script. Only pluck.toml sets them, so Home never sees or
  /// rewrites them.
  #[serde(default, skip_serializing)]
  pub env: BTreeMap<String, String>,
}

fn notify() -> Output {
  Output::Notify
}

#[derive(Default)]
pub struct Config {
  pub actions: Vec<Action>,
  /// One line per thing that couldn't be read, shown in the menu.
  pub problems: Vec<String>,
}

/// Reads pluck.toml from the config folder, creating the sample config first if there is none.
/// Invalid entries are skipped and reported, so the valid ones keep working.
pub fn load(dir: &Path) -> Config {
  let path = dir.join("pluck.toml");
  if !path.exists()
    && let Err(error) = write_defaults(dir)
  {
    return broken(format!("Couldn't create {}: {error}", path.display()));
  }
  let text = match fs::read_to_string(&path) {
    Ok(text) => text,
    Err(error) => return broken(format!("Couldn't read {}: {error}", path.display())),
  };
  let table = match toml::from_str::<toml::Table>(&text) {
    Ok(table) => table,
    Err(error) => return broken(format!("pluck.toml: {}", error.message())),
  };

  let mut config = Config::default();
  let entries = table.get("action").and_then(|value| value.as_array());
  for (index, entry) in entries.into_iter().flatten().enumerate() {
    match entry.clone().try_into::<Action>() {
      Ok(action) if action.run.is_empty() && action.agent.is_none() => {
        config.problems.push(format!("pluck.toml, action {}: needs `run` or `agent`", index + 1));
      }
      Ok(action) if action.agent.is_none() && action.output == Output::Session => {
        config.problems.push(format!("pluck.toml, action {}: only `agent` actions can open a session", index + 1));
      }
      Ok(mut action) => {
        if action.agent.is_some() && entry.get("output").is_none() {
          // `interactive = false` asked for a reply in the menu before prompts had an output.
          let one_off = entry.get("interactive").and_then(toml::Value::as_bool) == Some(false);
          action.output = if one_off { Output::Show } else { Output::Session };
        }
        config.actions.push(action);
      }
      Err(error) => config.problems.push(format!("pluck.toml, action {}: {}", index + 1, error.message())),
    }
  }
  config
}

/// Writes `actions` to pluck.toml as its `[[action]]` list, in order. Everything else in the file,
/// and each kept entry's own comments and quoting, stays as the user wrote it.
pub fn save_actions(dir: &Path, actions: &[Action]) -> Result<(), String> {
  // Entries that don't load can't be shown or edited, so saving would silently drop them.
  if let Some(problem) = load(dir).problems.first() {
    return Err(format!("Fix pluck.toml first. {problem}"));
  }
  let path = dir.join("pluck.toml");
  let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
  let mut document = text.parse::<DocumentMut>().map_err(|error| error.to_string())?;
  let mut previous = document.remove("action").and_then(|item| item.into_array_of_tables().ok()).unwrap_or_default();

  // The file's opening comments belong to its first entry; keep them at the top instead.
  let header = previous.get_mut(0).and_then(|first| {
    let header = first.decor().prefix().cloned();
    first.decor_mut().set_prefix("\n");
    header
  });

  let mut tables = ArrayOfTables::new();
  for action in actions {
    let index = previous.iter().position(|table| table.get("id").and_then(Item::as_str) == Some(&action.id));
    let mut table = index.map(|index| previous.remove(index)).unwrap_or_default();
    // The file is written in each table's remembered position, which would undo a reorder.
    table.set_position(None);
    let script = action.agent.is_none();
    set(&mut table, "id", Some(&action.id));
    set(&mut table, "name", Some(&action.name));
    set(&mut table, "key", action.key.as_deref());
    set(&mut table, "run", Some(action.run.as_str()).filter(|_| script));
    set(&mut table, "agent", action.agent.as_deref());
    let default = if script { Output::Notify } else { Output::Session };
    set(&mut table, "output", Some(action.output.name()).filter(|_| action.output != default));
    table.remove("interactive");
    set(&mut table, "model", action.model.as_deref().filter(|_| !script));
    set(&mut table, "thinking", action.thinking.as_deref().filter(|_| !script));
    tables.push(table);
  }
  if let (Some(header), Some(first)) = (header, tables.get_mut(0)) {
    first.decor_mut().set_prefix(header);
  }
  document.insert("action", Item::ArrayOfTables(tables));
  fs::write(path, document.to_string()).map_err(|error| error.to_string())
}

/// Leaves an unchanged value alone, so its quoting survives.
fn set(table: &mut Table, key: &str, text: Option<&str>) {
  match text {
    Some(text) if table.get(key).and_then(Item::as_str) != Some(text) => {
      table.insert(key, value(text));
    }
    Some(_) => {}
    None => {
      table.remove(key);
    }
  }
}

fn broken(problem: String) -> Config {
  Config { problems: vec![problem], ..Config::default() }
}

#[derive(Serialize, Deserialize)]
pub struct Settings {
  pub hotkey: String,
  /// Windows only: scripts and agents run inside WSL instead of Windows.
  #[serde(default)]
  pub wsl: bool,
  /// Windows only: in a browser with nothing selected, copy the page's address from its address bar.
  #[serde(default)]
  pub browser_url: bool,
  #[serde(default)]
  pub agent: AgentSettings,
}

/// Which installed agent harness runs sessions, and how. Unset model and thinking use the harness's defaults.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
  pub harness: Harness,
  pub model: Option<String>,
  pub thinking: Option<String>,
  /// Where new sessions run, inside WSL when the settings say so.
  pub folder: String,
}

impl Default for AgentSettings {
  fn default() -> Self {
    Self { harness: Harness::Pi, model: None, thinking: None, folder: "~".into() }
  }
}

pub fn settings(dir: &Path) -> Settings {
  fs::read_to_string(dir.join(SETTINGS))
    .ok()
    .and_then(|text| serde_json::from_str(&text).ok())
    .unwrap_or_else(|| Settings { hotkey: DEFAULT_HOTKEY.into(), wsl: false, browser_url: false, agent: AgentSettings::default() })
}

pub fn save_settings(dir: &Path, settings: &Settings) -> io::Result<()> {
  fs::create_dir_all(dir)?;
  fs::write(dir.join(SETTINGS), serde_json::to_string_pretty(settings)?)
}

fn write_defaults(dir: &Path) -> io::Result<()> {
  fs::create_dir_all(dir.join("scripts"))?;
  for (file, text) in DEFAULT_FILES {
    let path = dir.join(file);
    if !path.exists() {
      fs::write(path, text)?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn prompt(id: &str, text: &str) -> Action {
    Action { id: id.into(), name: id.into(), key: Some(id.into()), run: String::new(), agent: Some(text.into()), output: Output::Session, model: None, thinking: None, env: BTreeMap::new() }
  }

  fn dir_with(name: &str, toml: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("pluck-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("pluck.toml"), toml).unwrap();
    dir
  }

  #[test]
  // actions-tab.edit
  fn menu_tab_edit_keeps_comments_and_writes_order() {
    let dir = dir_with(
      "keeps",
      "# my notes\n\n[[action]]\nid = \"a\"\nname = \"A\"\nrun = 'scripts\\a.ps1' # windows path\n\n[[action]]\nid = \"b\"\nname = \"B\"\nrun = \"b\"\n\n[[action]]\nid = \"d\"\nname = \"D\"\nrun = \"d\"\n",
    );
    let mut loaded = load(&dir).actions;
    let d = loaded.remove(2);
    let mut a = loaded.remove(0);
    a.key = Some("x".into());
    save_actions(&dir, &[prompt("c", "Give me the context."), d, a]).unwrap();

    let text = fs::read_to_string(dir.join("pluck.toml")).unwrap();
    assert!(text.starts_with("# my notes"), "{text}");
    assert!(text.contains("run = 'scripts\\a.ps1' # windows path"), "{text}");
    let saved: Vec<_> = load(&dir).actions.into_iter().map(|action| (action.id, action.key, action.agent)).collect();
    assert_eq!(
      saved,
      [
        ("c".into(), Some("c".into()), Some("Give me the context.".into())),
        ("d".into(), None, None),
        ("a".into(), Some("x".into()), None)
      ]
    );
  }

  #[test]
  // actions-tab.agent
  fn menu_tab_agent_keeps_model_thinking_and_output() {
    let dir = dir_with("agent", "");
    let mut quick = prompt("q", "Define this.");
    quick.output = Output::Notify;
    quick.model = Some("anthropic/claude-haiku-5-5".into());
    quick.thinking = Some("off".into());
    save_actions(&dir, &[quick, prompt("e", "Explain this.")]).unwrap();

    let text = fs::read_to_string(dir.join("pluck.toml")).unwrap();
    assert_eq!(text.matches("output").count(), 1, "{text}");
    let saved: Vec<_> = load(&dir).actions.into_iter().map(|action| (action.output, action.model, action.thinking)).collect();
    assert!(saved == [(Output::Notify, Some("anthropic/claude-haiku-5-5".into()), Some("off".into())), (Output::Session, None, None)]);
  }

  #[test]
  // output.default
  fn prompts_open_a_session_unless_they_asked_for_a_reply_in_the_menu() {
    let dir = dir_with("one-off", "[[action]]\nid = \"a\"\nname = \"A\"\nagent = \"x\"\n\n[[action]]\nid = \"b\"\nname = \"B\"\nagent = \"x\"\ninteractive = false\n");
    let outputs: Vec<_> = load(&dir).actions.into_iter().map(|action| action.output).collect();
    assert!(outputs == [Output::Session, Output::Show]);
  }

  #[test]
  // action.env
  fn action_env_loads_and_survives_saving() {
    let dir = dir_with("env", "[[action]]\nid = \"r\"\nname = \"R\"\nrun = \"r\"\nenv = { VOICE = \"af_heart\" }\n");
    let mut actions = load(&dir).actions;
    assert_eq!(actions[0].env, BTreeMap::from([("VOICE".into(), "af_heart".into())]));
    actions[0].env.clear();
    actions[0].name = "Read".into();
    save_actions(&dir, &actions).unwrap();
    assert_eq!(load(&dir).actions[0].env.get("VOICE").map(String::as_str), Some("af_heart"));
  }

  #[test]
  // actions-tab.edit
  fn menu_tab_edit_refuses_while_an_entry_is_invalid() {
    let dir = dir_with("invalid", "[[action]]\nid = \"a\"\nname = \"A\"\n");
    assert!(save_actions(&dir, &[]).unwrap_err().starts_with("Fix pluck.toml first"));
  }
}
