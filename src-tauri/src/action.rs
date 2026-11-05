//! Running an action's command with the selection.

use std::{
  io::{self, BufRead, BufReader, Read, Write},
  path::Path,
  process::{Child, Command, ExitStatus, Stdio},
  thread,
};

/// Windows caps one environment variable at 32,767 characters; longer text only goes to stdin.
const MAX_ENV_TEXT: usize = 32_000;

/// Starts `command` in the platform shell, or in WSL's bash when `wsl` is set on Windows, in `dir`,
/// with the text on stdin and in PLUCK_TEXT.
pub fn spawn(command: &str, wsl: bool, dir: &Path, text: &str, env: &[(&str, &str)]) -> io::Result<Child> {
  let mut shell = shell(command, wsl);
  shell.current_dir(dir).envs(env.iter().copied());
  if text.len() <= MAX_ENV_TEXT {
    shell.env("PLUCK_TEXT", text);
  }
  shell.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  let mut child = shell.spawn()?;

  let mut stdin = child.stdin.take().expect("stdin is piped");
  let text = text.to_string();
  // A script that never reads stdin would block a large write, and the command's exit says enough.
  thread::spawn(move || stdin.write_all(text.as_bytes()));
  Ok(child)
}

/// Calls `on_line` for each line of stdout as it arrives.
pub fn stream(mut child: Child, mut on_line: impl FnMut(String)) -> Result<(), String> {
  let mut stderr = child.stderr.take().expect("stderr is piped");
  let errors = thread::spawn(move || {
    let mut text = String::new();
    let _ = stderr.read_to_string(&mut text);
    text
  });
  let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped"));
  let mut line = Vec::new();
  while stdout.read_until(b'\n', &mut line).map_err(|error| error.to_string())? > 0 {
    on_line(String::from_utf8_lossy(&line).into_owned());
    line.clear();
  }
  let status = child.wait().map_err(|error| error.to_string())?;
  outcome(status, errors.join().unwrap_or_default())
}

/// Waits for the command and returns its stdout.
pub fn finish(child: Child) -> Result<String, String> {
  let output = child.wait_with_output().map_err(|error| error.to_string())?;
  outcome(output.status, String::from_utf8_lossy(&output.stderr).into_owned())?;
  Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn outcome(status: ExitStatus, stderr: String) -> Result<(), String> {
  if status.success() {
    return Ok(());
  }
  let stderr = stderr.trim();
  Err(if stderr.is_empty() { format!("Exited with {status}") } else { stderr.to_string() })
}

/// Like `bash -l`, for the PATH a profile sets, but a profile's greetings don't end up in the
/// script's output. `$0` is the command.
#[cfg(windows)]
const QUIET_LOGIN: &str = r#"{ . /etc/profile; for f in ~/.bash_profile ~/.bash_login ~/.profile; do [ -r "$f" ] && { . "$f"; break; }; done; } >/dev/null 2>&1; eval "$0""#;

#[cfg(windows)]
fn shell(command: &str, wsl: bool) -> Command {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let mut shell = if wsl {
    // wsl.exe starts in the Windows working folder and passes on the variables WSLENV names.
    let mut shell = Command::new("wsl.exe");
    shell.args(["-e", "bash", "-c", QUIET_LOGIN, command]);
    let names = "PLUCK_TEXT:PLUCK_APP:PLUCK_TITLE:PLUCK_URL";
    let wslenv = std::env::var("WSLENV").map_or(names.to_string(), |current| format!("{current}:{names}"));
    shell.env("WSLENV", wslenv);
    shell
  } else {
    let mut shell = Command::new("cmd");
    shell.arg("/C").raw_arg(command);
    shell
  };
  shell.creation_flags(CREATE_NO_WINDOW);
  shell
}

#[cfg(not(windows))]
fn shell(command: &str, _wsl: bool) -> Command {
  let mut shell = Command::new("sh");
  shell.arg("-c").arg(command);
  shell
}
