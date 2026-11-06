//! Pi in RPC mode. Its records are pluck's, so they pass through as they are.

use super::{config_folder, read_records, spawn, Harness, Kind, Model};
use serde_json::Value;
use std::{fs, io::Write};

pub fn args(kind: &Kind) -> Vec<String> {
  let mut args = vec!["--mode".to_string(), "rpc".into()];
  match kind {
    Kind::New(id, _) => args.extend(["--session-id".into(), id.to_string()]),
    Kind::Resume(session) => args.extend(["--session-id".into(), session.id.clone()]),
    Kind::Reply(_) => args.push("--no-session".into()),
  }
  if let Kind::New(_, model) | Kind::Reply(model) = kind {
    args.extend(model.flags("--thinking"));
  }
  args
}

/// The models Pi can use, Pi's settings, which hold the user's model scope and per-model thinking
/// levels, and the model and thinking level a new session starts with, asked from a short-lived process.
pub fn models(folder: &str, wsl: bool) -> Result<Value, String> {
  // Pi's settings live where Pi runs; only a shell there can read them.
  let by_shell = wsl || cfg!(not(windows));
  let mut child = spawn(Harness::Pi, folder, wsl, &args(&Kind::Reply(&Model::default()))).map_err(|error| error.to_string())?;
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
  let reason = read_records(Harness::Pi, &mut child, |record| {
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
    None if !by_shell => fs::read_to_string(config_folder("PI_CODING_AGENT_DIR", ".pi/agent").join("settings.json")).ok(),
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
