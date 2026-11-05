//! Running an action's command with the selection.

use std::{
  io::{self, BufRead, BufReader, Read, Write},
  path::Path,
  process::{Child, Command, ExitStatus, Stdio},
  thread,
};

/// Windows caps one environment variable at 32,767 characters; longer text only goes to stdin.
const MAX_ENV_TEXT: usize = 32_000;

/// Starts `command` in the platform shell, in `dir`, with the text on stdin and in PLUCK_TEXT.
pub fn spawn(command: &str, dir: &Path, text: &str, env: &[(&str, &str)]) -> io::Result<Child> {
  let mut shell = shell(command);
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

#[cfg(windows)]
fn shell(command: &str) -> Command {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let mut shell = Command::new("cmd");
  shell.arg("/C").raw_arg(command).creation_flags(CREATE_NO_WINDOW);
  shell
}

#[cfg(not(windows))]
fn shell(command: &str) -> Command {
  let mut shell = Command::new("sh");
  shell.arg("-c").arg(command);
  shell
}
