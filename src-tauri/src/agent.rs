//! Agent sessions. Each one runs an installed harness (Pi, Claude Code or Codex) as its own process.
//! Pluck speaks Pi's RPC records with the agents window; Pi takes them as they are, and the other
//! harnesses' adapters translate both ways. Pluck keeps a list of the sessions it started.

mod claude;
mod codex;
mod pi;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
  collections::HashMap,
  env, fs,
  io::{self, BufRead, BufReader, Read, Write},
  path::{Path, PathBuf},
  process::{Child, ChildStdin, Command, Stdio},
  sync::{Arc, Mutex},
  thread,
  time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const SESSIONS: &str = "agents.json";
/// Pluck's, in the config folder next to the user's files.
const GUIDE: &str = "GUIDE.md";
/// For a shell: `$0` is the working folder, the rest the harness and its arguments. A login shell
/// puts the harness on the PATH.
const LAUNCH: &str = r#"cd "${0/#\~/$HOME}" && exec "$@""#;

/// Session threads and commands both write the session list.
static SESSIONS_FILE: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Harness {
  #[default]
  Pi,
  Claude,
  Codex,
}

impl Harness {
  pub fn name(self) -> &'static str {
    match self {
      Harness::Pi => "Pi",
      Harness::Claude => "Claude Code",
      Harness::Codex => "Codex",
    }
  }

  fn program(self) -> &'static str {
    match self {
      Harness::Pi => "pi",
      Harness::Claude => "claude",
      Harness::Codex => "codex",
    }
  }
}

/// The model and thinking level a new session or reply runs with; unset ones are left to the harness.
#[derive(Default)]
pub struct Model {
  pub model: Option<String>,
  pub thinking: Option<String>,
}

impl Model {
  /// `--model` and the harness's flag for the thinking level, for the ones that are set.
  fn flags(&self, thinking: &str) -> Vec<String> {
    let model = self.model.iter().flat_map(|model| ["--model".to_string(), model.clone()]);
    model.chain(self.thinking.iter().flat_map(|level| [thinking.to_string(), level.clone()])).collect()
  }
}

/// What a harness process is for. A session comes with what it is told about pluck (`context`).
pub enum Kind<'a> {
  New(&'a str, &'a Model, &'a str),
  Resume(&'a AgentSession, &'a str),
  /// One reply that isn't kept.
  Reply(&'a Model),
}

impl Kind<'_> {
  fn context(&self) -> Option<&str> {
    match self {
      Kind::New(_, _, context) | Kind::Resume(_, context) => Some(context),
      Kind::Reply(_) => None,
    }
  }
}

/// What a session is told about pluck: where its actions live and which guide to read before
/// changing them. Writes that guide. One line without quotes, since on Windows it passes through
/// cmd.exe as an argument.
fn context(dir: &Path, wsl: bool) -> io::Result<String> {
  fs::create_dir_all(dir)?;
  fs::write(dir.join(GUIDE), include_str!("agent/guide.md"))?;
  let folder = dir.display().to_string();
  let folder = if wsl { wsl_path(&folder) } else { folder };
  let shell = if wsl {
    "bash in WSL"
  } else if cfg!(windows) {
    "cmd.exe"
  } else {
    "sh"
  };
  Ok(format!(
    "You run inside Pluck, a desktop app that sends the text the user selects in any app to their own actions, which are scripts and agent prompts in a small hotkey menu. The actions are in pluck.toml in Pluck's config folder, {folder}, and its scripts run through {shell}. When asked to create, change or fix an action or its script, read {GUIDE} in that folder first."
  ))
}

/// Translates between Pi's records and the harness's own.
enum Adapter {
  Pi,
  Claude(claude::Adapter),
  Codex(codex::Adapter),
}

/// What an adapter makes of one record: records for pluck, lines for the harness, and the
/// harness's own id for the session once it has one.
#[derive(Default)]
struct Out {
  emit: Vec<Value>,
  write: Vec<Value>,
  thread: Option<String>,
}

impl Adapter {
  /// The adapter, the harness's arguments and what to send it first.
  fn open(harness: Harness, kind: &Kind, wsl: bool) -> (Adapter, Vec<String>, Vec<Value>) {
    match harness {
      Harness::Pi => (Adapter::Pi, pi::args(kind), Vec::new()),
      Harness::Claude => {
        let (adapter, args) = claude::Adapter::open(kind, wsl);
        (Adapter::Claude(adapter), args, Vec::new())
      }
      Harness::Codex => {
        let (adapter, writes) = codex::Adapter::open(kind);
        (Adapter::Codex(adapter), vec!["app-server".into()], writes)
      }
    }
  }

  /// A command from pluck.
  fn command(&mut self, record: Value) -> Out {
    match self {
      Adapter::Pi => Out { write: vec![record], ..Out::default() },
      Adapter::Claude(adapter) => adapter.command(record),
      Adapter::Codex(adapter) => adapter.command(record),
    }
  }

  /// A record from the harness.
  fn record(&mut self, record: Value) -> Out {
    match self {
      Adapter::Pi => Out { emit: vec![record], ..Out::default() },
      Adapter::Claude(adapter) => adapter.record(record),
      Adapter::Codex(adapter) => adapter.record(record),
    }
  }
}

/// A running session: its stdin, which closing asks the harness to shut down, and its adapter.
struct Pipe {
  stdin: Option<ChildStdin>,
  adapter: Adapter,
}

impl Pipe {
  fn write(&mut self, records: &[Value]) -> io::Result<()> {
    write(&mut self.stdin, records)
  }
}

fn write(stdin: &mut Option<ChildStdin>, records: &[Value]) -> io::Result<()> {
  let stdin = stdin.as_mut().ok_or(io::ErrorKind::BrokenPipe)?;
  for record in records {
    writeln!(stdin, "{record}")?;
  }
  stdin.flush()
}

/// Every running session, by session id.
#[derive(Default)]
pub struct Agents(Mutex<HashMap<String, Arc<Mutex<Pipe>>>>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
  pub id: String,
  pub title: String,
  pub folder: String,
  pub wsl: bool,
  #[serde(default)]
  pub harness: Harness,
  /// The harness's own id for the session, when it picks one (Codex).
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub thread: Option<String>,
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

fn emit(app: &AppHandle, id: &str, record: Option<Value>, exited: Option<String>) {
  let _ = app.emit("pluck://agent", AgentEvent { id: id.to_string(), record, exited });
}

/// Starts the session's process unless it is already running, and streams its records as `pluck://agent`.
/// `model` is set for a session that is new. Each finished run updates the session's `last_active` in `dir`.
pub fn start(app: &AppHandle, agents: &Agents, dir: &Path, session: &AgentSession, model: Option<&Model>) -> io::Result<()> {
  let mut running = agents.0.lock().unwrap();
  if running.contains_key(&session.id) {
    return Ok(());
  }
  let context = context(dir, session.wsl)?;
  let kind = match model {
    Some(model) => Kind::New(&session.id, model, &context),
    None => Kind::Resume(session, &context),
  };
  let (adapter, args, first) = Adapter::open(session.harness, &kind, session.wsl);
  let mut child = spawn(session.harness, &session.folder, session.wsl, &args)?;
  let pipe = Arc::new(Mutex::new(Pipe { stdin: child.stdin.take(), adapter }));
  pipe.lock().unwrap().write(&first)?;
  running.insert(session.id.clone(), pipe.clone());

  let app = app.clone();
  let dir = dir.to_path_buf();
  let (id, harness) = (session.id.clone(), session.harness);
  thread::spawn(move || {
    let reason = read_records(harness, &mut child, |record| {
      let out = {
        let mut pipe = pipe.lock().unwrap();
        let out = pipe.adapter.record(record);
        let _ = pipe.write(&out.write);
        out
      };
      if let Some(thread) = out.thread {
        let _ = update_sessions(&dir, |sessions| {
          sessions.iter_mut().filter(|session| session.id == id).for_each(|session| session.thread = Some(thread.clone()));
        });
      }
      for record in out.emit {
        if record["type"] == "agent_settled" {
          let _ = update_sessions(&dir, |sessions| {
            sessions.iter_mut().filter(|session| session.id == id).for_each(|session| session.last_active = now());
          });
        }
        emit(&app, &id, Some(record), None);
      }
    });
    app.state::<Agents>().0.lock().unwrap().remove(&id);
    emit(&app, &id, None, Some(reason));
  });
  Ok(())
}

/// Ends the session's process, if it runs, and takes it off the list. The harness keeps its own copy.
pub fn remove(agents: &Agents, dir: &Path, id: &str) -> io::Result<()> {
  if let Some(pipe) = agents.0.lock().unwrap().remove(id) {
    pipe.lock().unwrap().stdin = None;
  }
  update_sessions(dir, |sessions| sessions.retain(|session| session.id != id))
}

/// Sends one command record to a running session.
pub fn send(app: &AppHandle, agents: &Agents, id: &str, record: Value) -> Result<(), String> {
  let pipe = agents.0.lock().unwrap().get(id).cloned().ok_or("This session isn't running")?;
  let out = {
    let mut pipe = pipe.lock().unwrap();
    let out = pipe.adapter.command(record);
    pipe.write(&out.write).map_err(|error| error.to_string())?;
    out
  };
  for record in out.emit {
    emit(app, id, Some(record), None);
  }
  Ok(())
}

/// Sends `prompt` to a short-lived process that keeps no session and passes on its reply's text as
/// it streams in. Returns once the harness has finished, with its error when the run failed.
pub fn reply(harness: Harness, folder: &str, wsl: bool, model: &Model, prompt: &str, mut on_text: impl FnMut(String)) -> Result<(), String> {
  let (mut adapter, args, first) = Adapter::open(harness, &Kind::Reply(model), wsl);
  let mut child = spawn(harness, folder, wsl, &args).map_err(|error| error.to_string())?;
  let mut stdin = child.stdin.take();
  let asked = adapter.command(serde_json::json!({ "type": "prompt", "message": prompt }));
  write(&mut stdin, &[first, asked.write].concat()).map_err(|error| error.to_string())?;
  let (mut settled, mut failure) = (false, None);
  let reason = read_records(harness, &mut child, |record| {
    let out = adapter.record(record);
    let mut answers = out.write;
    for record in out.emit {
      match record["type"].as_str() {
        Some("message_update") => {
          let event = &record["assistantMessageEvent"];
          if event["type"] == "text_delta" {
            on_text(event["delta"].as_str().unwrap_or("").to_string());
          }
        }
        // Errors like "Connection error." don't say which model failed.
        Some("message_end") if record["message"]["stopReason"] == "error" => {
          let message = &record["message"];
          let text = message["errorMessage"].as_str().unwrap_or("The agent failed");
          failure = Some(format!("{text} ({}/{})", message["provider"].as_str().unwrap_or(""), message["model"].as_str().unwrap_or("")));
        }
        Some("response") if record["success"] == false => failure = record["error"].as_str().map(String::from),
        // Nobody is there to answer, so questions are cancelled.
        Some("extension_ui_request") if record["method"] != "notify" => {
          let cancel = serde_json::json!({ "type": "extension_ui_response", "id": record["id"], "cancelled": true });
          answers.extend(adapter.command(cancel).write);
        }
        Some("agent_settled") => settled = true,
        _ => {}
      }
    }
    let _ = write(&mut stdin, &answers);
    if settled {
      stdin = None;
    }
  });
  match failure {
    Some(failure) => Err(failure),
    None if settled => Ok(()),
    None => Err(reason),
  }
}

/// The models the harness offers, as the agents window reads them: `models` in Pi's shape,
/// Pi's `settings`, and the model and thinking level a new session `start`s with.
pub fn models(harness: Harness, folder: &str, wsl: bool) -> Result<Value, String> {
  match harness {
    Harness::Pi => pi::models(folder, wsl),
    Harness::Claude => claude::models(folder, wsl),
    Harness::Codex => codex::models(folder, wsl),
  }
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

fn home() -> PathBuf {
  env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default()
}

/// The harness's config folder: `variable` when it is set, else `default` in the home folder.
fn config_folder(variable: &str, default: &str) -> PathBuf {
  env::var_os(variable).map(PathBuf::from).unwrap_or_else(|| home().join(default))
}

/// Runs `script` in WSL's login shell with `arg` as `$0` and returns its output; for reading a
/// harness's files there.
#[cfg(windows)]
fn wsl_output(script: &str, arg: &str) -> Result<String, String> {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let output = Command::new("wsl.exe")
    .args(["-e", "bash", "-lc", script, arg])
    .creation_flags(CREATE_NO_WINDOW)
    .output()
    .map_err(|error| error.to_string())?;
  match output.status.success() {
    true => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
    false => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
  }
}

fn spawn(harness: Harness, folder: &str, wsl: bool, args: &[String]) -> io::Result<Child> {
  let mut command = launcher(folder, wsl);
  command.arg(harness.program()).args(args);
  command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  command.spawn()
}

/// On Windows the harness runs either inside WSL or natively, as the settings say.
#[cfg(windows)]
fn launcher(folder: &str, wsl: bool) -> Command {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let mut command = if wsl {
    let mut command = Command::new("wsl.exe");
    command.args(["-e", "bash", "-lc", LAUNCH, folder]);
    command
  } else {
    // npm and pnpm install harnesses as .cmd scripts, which only cmd runs.
    let mut command = Command::new("cmd");
    command.arg("/C");
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
fn read_records(harness: Harness, child: &mut Child, mut on_record: impl FnMut(Value)) -> String {
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
    Ok(status) if status.success() => format!("{} stopped", harness.name()),
    _ => stderr.lines().rev().find(|line| !line.trim().is_empty()).map_or_else(|| format!("{} couldn't start", harness.name()), String::from),
  }
}

/// Pi's text part.
fn text(text: &str) -> Value {
  serde_json::json!({ "type": "text", "text": text })
}

/// A Pi message that is complete: added and finished at once.
fn whole(message: Value) -> [Value; 2] {
  [serde_json::json!({ "type": "message_start", "message": message }), serde_json::json!({ "type": "message_end", "message": message })]
}

/// A Pi stream event for the reply being written.
fn update(event: Value) -> Value {
  serde_json::json!({ "type": "message_update", "assistantMessageEvent": event })
}

/// Pi's answer to a command.
fn response(command: &str, data: Value) -> Value {
  serde_json::json!({ "type": "response", "command": command, "success": true, "data": data })
}

fn failed(command: &str, error: &str) -> Value {
  serde_json::json!({ "type": "response", "command": command, "success": false, "error": error })
}

/// A yes or no question, as Pi's extensions ask it.
fn confirm(id: &str, title: &str, message: &str) -> Value {
  serde_json::json!({ "type": "extension_ui_request", "id": id, "method": "confirm", "title": title, "message": message })
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
