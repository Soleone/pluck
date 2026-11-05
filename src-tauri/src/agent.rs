//! Agent sessions. Each one runs the installed harness (Pi) in RPC mode as its own process; pluck
//! passes its JSON records through to the agents window and keeps a list of the sessions it started.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
  collections::HashMap,
  env, fs,
  io::{self, BufRead, BufReader, Read, Write},
  path::{Path, PathBuf},
  process::{Child, ChildStdin, Command, Stdio},
  sync::Mutex,
  thread,
  time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const SESSIONS: &str = "agents.json";
/// For a shell: `$0` is the working folder, the rest are Pi's arguments. A login shell puts Pi on the PATH.
const LAUNCH: &str = r#"cd "${0/#\~/$HOME}" && exec pi --mode rpc "$@""#;

/// Session threads and commands both write the session list.
static SESSIONS_FILE: Mutex<()> = Mutex::new(());

/// The stdin of every running session, by session id.
#[derive(Default)]
pub struct Agents(Mutex<HashMap<String, ChildStdin>>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
  pub id: String,
  pub title: String,
  pub folder: String,
  pub wsl: bool,
  /// When the session last finished a run, in milliseconds since 1970. The model provider's prompt
  /// cache expires a few minutes after that, which makes continuing an older session cost more.
  #[serde(default)]
  pub last_active: u64,
}

/// One record from a session's harness, or its exit with the reason.
#[derive(Clone, Serialize)]
struct AgentEvent {
  id: String,
  record: Option<Value>,
  exited: Option<String>,
}

/// Most recently active first.
pub fn sessions(dir: &Path) -> Vec<AgentSession> {
  let _file = SESSIONS_FILE.lock().unwrap();
  read_sessions(dir)
}

/// Changes the session list on disk.
pub fn update_sessions(dir: &Path, change: impl FnOnce(&mut Vec<AgentSession>)) -> io::Result<()> {
  let _file = SESSIONS_FILE.lock().unwrap();
  let mut sessions = read_sessions(dir);
  change(&mut sessions);
  sessions.sort_by_key(|session| std::cmp::Reverse(session.last_active));
  fs::create_dir_all(dir)?;
  fs::write(dir.join(SESSIONS), serde_json::to_string_pretty(&sessions)?)
}

fn read_sessions(dir: &Path) -> Vec<AgentSession> {
  fs::read_to_string(dir.join(SESSIONS)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn now() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64)
}

/// Starts the session's process unless it is already running, and streams its records as `pluck://agent`.
/// Each finished run updates the session's `last_active` in `dir`.
pub fn start(app: &AppHandle, agents: &Agents, dir: &Path, session: &AgentSession, args: &[String]) -> io::Result<()> {
  let mut running = agents.0.lock().unwrap();
  if running.contains_key(&session.id) {
    return Ok(());
  }
  let mut child = spawn(&session.folder, session.wsl, &[&["--session-id".to_string(), session.id.clone()], args].concat())?;
  running.insert(session.id.clone(), child.stdin.take().expect("stdin is piped"));

  let app = app.clone();
  let dir = dir.to_path_buf();
  let id = session.id.clone();
  thread::spawn(move || {
    let emit = |record, exited| {
      let _ = app.emit("pluck://agent", AgentEvent { id: id.clone(), record, exited });
    };
    let reason = read_records(&mut child, |record| {
      if record["type"] == "agent_settled" {
        let _ = update_sessions(&dir, |sessions| {
          sessions.iter_mut().filter(|session| session.id == id).for_each(|session| session.last_active = now());
        });
      }
      emit(Some(record), None)
    });
    app.state::<Agents>().0.lock().unwrap().remove(&id);
    emit(None, Some(reason));
  });
  Ok(())
}

/// Ends the session's process, if it runs, and takes it off the list. Pi keeps its own copy.
pub fn remove(agents: &Agents, dir: &Path, id: &str) -> io::Result<()> {
  // Without stdin Pi shuts down.
  agents.0.lock().unwrap().remove(id);
  update_sessions(dir, |sessions| sessions.retain(|session| session.id != id))
}

/// Writes one command record to a running session.
pub fn send(agents: &Agents, id: &str, record: &str) -> Result<(), String> {
  let mut running = agents.0.lock().unwrap();
  let stdin = running.get_mut(id).ok_or("This session isn't running")?;
  writeln!(stdin, "{record}").and_then(|()| stdin.flush()).map_err(|error| error.to_string())
}

/// The models Pi can use, Pi's settings, which hold the user's model scope and per-model thinking
/// levels, and the model and thinking level a new session starts with, asked from a short-lived process.
pub fn models(folder: &str, wsl: bool) -> Result<Value, String> {
  // Pi's settings live where Pi runs; only a shell there can read them.
  let by_shell = wsl || cfg!(not(windows));
  let mut child = spawn(folder, wsl, &["--no-session".into()]).map_err(|error| error.to_string())?;
  let mut stdin = child.stdin.take();
  let ask = stdin.as_mut().expect("stdin is piped");
  let mut commands = vec![
    serde_json::json!({ "id": "models", "type": "get_available_models" }),
    serde_json::json!({ "id": "state", "type": "get_state" }),
  ];
  if by_shell {
    let settings = r#"cat "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/settings.json""#;
    commands.push(serde_json::json!({ "id": "settings", "type": "bash", "command": settings, "excludeFromContext": true }));
  }
  for command in commands {
    writeln!(ask, "{command}").map_err(|error| error.to_string())?;
  }
  let (mut models, mut state, mut settings) = (None, None, None);
  let reason = read_records(&mut child, |record| {
    if record["type"] != "response" {
      return;
    }
    match record["id"].as_str() {
      Some("models") => models = Some(record),
      Some("state") => state = Some(record),
      Some("settings") => settings = Some(record),
      _ => return,
    }
    if models.is_some() && state.is_some() && (settings.is_some() || !by_shell) {
      // Closing stdin asks Pi to shut down.
      stdin = None;
    }
  });
  let models = models.ok_or(reason)?;
  if models["success"] != true {
    return Err(models["error"].as_str().unwrap_or("Pi couldn't list its models").to_string());
  }
  let text = match settings {
    Some(record) => record["data"]["output"].as_str().map(String::from),
    None if !by_shell => fs::read_to_string(pi_dir().join("settings.json")).ok(),
    None => None,
  };
  // Missing or unreadable settings just mean Pi's defaults.
  let settings = text.and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null);
  // Pi picks its starting model from the scope, the saved default or what has a key, so ask it.
  let start = state.map(|record| record["data"].clone()).filter(|data| data["model"].is_object()).map(|data| {
    let model = &data["model"];
    serde_json::json!({ "model": format!("{}/{}", model["provider"].as_str().unwrap_or(""), model["id"].as_str().unwrap_or("")), "thinking": data["thinkingLevel"] })
  });
  Ok(serde_json::json!({ "models": models["data"]["models"], "settings": settings, "start": start }))
}

/// How WSL names a folder Windows picked: `\\wsl.localhost\Ubuntu\home\me` is `/home/me` and
/// `C:\Users\me` is `/mnt/c/Users/me`.
pub fn wsl_path(path: &str) -> String {
  let unc = ["\\\\wsl.localhost\\", "\\\\wsl$\\"].iter().find_map(|prefix| path.strip_prefix(prefix));
  if let Some(rest) = unc {
    let inside = rest.split_once('\\').map_or("", |(_distro, inside)| inside);
    return format!("/{}", inside.replace('\\', "/"));
  }
  match path.split_once(":\\") {
    Some((drive, rest)) if drive.len() == 1 => format!("/mnt/{}/{}", drive.to_lowercase(), rest.replace('\\', "/")),
    _ => path.to_string(),
  }
}

fn pi_dir() -> PathBuf {
  env::var_os("PI_CODING_AGENT_DIR").map(PathBuf::from).unwrap_or_else(|| home().join(".pi").join("agent"))
}

fn home() -> PathBuf {
  env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default()
}

fn spawn(folder: &str, wsl: bool, args: &[String]) -> io::Result<Child> {
  let mut command = launcher(folder, wsl);
  command.args(args);
  command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  command.spawn()
}

/// On Windows Pi runs either inside WSL or natively, as the settings say.
#[cfg(windows)]
fn launcher(folder: &str, wsl: bool) -> Command {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let mut command = if wsl {
    let mut command = Command::new("wsl.exe");
    command.args(["-e", "bash", "-lc", LAUNCH, folder]);
    command
  } else {
    // npm and pnpm install Pi as a .cmd script, which only cmd runs.
    let mut command = Command::new("cmd");
    command.args(["/C", "pi", "--mode", "rpc"]);
    let folder = match folder.strip_prefix('~') {
      Some(rest) => home().join(rest.trim_start_matches(['/', '\\'])),
      None => PathBuf::from(folder),
    };
    command.current_dir(folder);
    command
  };
  command.creation_flags(CREATE_NO_WINDOW);
  command
}

#[cfg(not(windows))]
fn launcher(folder: &str, _wsl: bool) -> Command {
  let mut command = Command::new("bash");
  command.args(["-lc", LAUNCH, folder]);
  command
}

/// Calls `on_record` for each JSON line of stdout until the process ends, then says why it ended.
/// Other lines, such as a shell profile's greeting, are skipped.
fn read_records(child: &mut Child, mut on_record: impl FnMut(Value)) -> String {
  let mut stderr = child.stderr.take().expect("stderr is piped");
  let errors = thread::spawn(move || {
    let mut text = String::new();
    let _ = stderr.read_to_string(&mut text);
    text
  });
  // Records are split on LF only; JSON strings may hold other line separators.
  let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped"));
  let mut line = Vec::new();
  while stdout.read_until(b'\n', &mut line).unwrap_or(0) > 0 {
    if let Ok(record) = serde_json::from_slice::<Value>(&line) {
      on_record(record);
    }
    line.clear();
  }
  let status = child.wait();
  let stderr = errors.join().unwrap_or_default();
  match status {
    Ok(status) if status.success() => "Pi stopped".into(),
    _ => stderr.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("Pi couldn't start").to_string(),
  }
}

#[cfg(test)]
mod tests {
  use super::wsl_path;

  #[test]
  // settings.agent-folder
  fn settings_agent_folder_picked_folders_are_named_as_wsl_sees_them() {
    assert_eq!(wsl_path(r"\\wsl.localhost\Ubuntu\home\me\src"), "/home/me/src");
    assert_eq!(wsl_path(r"\\wsl$\Ubuntu\home\me"), "/home/me");
    assert_eq!(wsl_path(r"\\wsl.localhost\Ubuntu"), "/");
    assert_eq!(wsl_path(r"D:\src\wsl"), "/mnt/d/src/wsl");
    assert_eq!(wsl_path("/home/me"), "/home/me");
  }
}
