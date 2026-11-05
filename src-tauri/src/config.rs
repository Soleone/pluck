use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path};

const DEFAULT_HOTKEY: &str = "Ctrl+Alt+Space";
/// Written by the settings screen, unlike pluck.toml which is the user's.
const SETTINGS: &str = "settings.json";

/// Written on first run so the menu has something to try.
const DEFAULT_FILES: [(&str, &str); 6] = [
  ("pluck.toml", include_str!("../defaults/pluck.toml")),
  ("scripts/translate.ps1", include_str!("../defaults/scripts/translate.ps1")),
  ("scripts/search.ps1", include_str!("../defaults/scripts/search.ps1")),
  ("scripts/bookmark.ps1", include_str!("../defaults/scripts/bookmark.ps1")),
  ("scripts/count.ps1", include_str!("../defaults/scripts/count.ps1")),
  ("scripts/upper.ps1", include_str!("../defaults/scripts/upper.ps1")),
];

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Output {
  Show,
  Copy,
  Notify,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Action {
  pub id: String,
  pub name: String,
  pub key: Option<String>,
  pub run: String,
  #[serde(default = "notify")]
  pub output: Output,
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
      Ok(action) => config.actions.push(action),
      Err(error) => config.problems.push(format!("pluck.toml, action {}: {}", index + 1, error.message())),
    }
  }
  config
}

fn broken(problem: String) -> Config {
  Config { problems: vec![problem], ..Config::default() }
}

#[derive(Serialize, Deserialize)]
struct Settings {
  hotkey: String,
}

pub fn hotkey(dir: &Path) -> String {
  fs::read_to_string(dir.join(SETTINGS))
    .ok()
    .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
    .map_or_else(|| DEFAULT_HOTKEY.to_string(), |settings| settings.hotkey)
}

pub fn save_hotkey(dir: &Path, hotkey: &str) -> io::Result<()> {
  fs::create_dir_all(dir)?;
  fs::write(dir.join(SETTINGS), serde_json::to_string_pretty(&Settings { hotkey: hotkey.to_string() })?)
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
