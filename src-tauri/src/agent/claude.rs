//! Claude Code in print mode, speaking stream-json both ways. It asks pluck before it uses a tool
//! its permission settings don't already allow, and keeps each session in a transcript file.

use super::{config_folder, confirm, failed, read_records, response, spawn, text, update, whole, Harness, Kind, Out};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::Write};

const STREAM: [&str; 9] = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--replay-user-messages",
  "--permission-prompt-tool=stdio",
];

pub struct Adapter {
  /// The session, for reading its transcript; None for a reply.
  session: Option<String>,
  wsl: bool,
  /// The model and level the session runs with, once Claude Code says which model.
  state: Option<Value>,
  thinking: Option<String>,
  /// The reply being streamed, as Pi parts, and the index of the block streaming now.
  parts: Vec<Value>,
  block: usize,
  /// What each tool waiting for permission was called with, by request id.
  asked: HashMap<String, Value>,
  /// Stop was clicked, so the run ending early isn't an error.
  aborted: bool,
}

impl Adapter {
  pub fn open(kind: &Kind, wsl: bool) -> (Adapter, Vec<String>) {
    let mut args: Vec<String> = STREAM.map(String::from).to_vec();
    let (session, thinking) = match kind {
      Kind::New(id, model) => {
        args.extend(["--session-id".into(), id.to_string()]);
        (Some(id.to_string()), model.thinking.clone())
      }
      Kind::Resume(session) => {
        args.extend(["--resume".into(), session.id.clone()]);
        (Some(session.id.clone()), None)
      }
      Kind::Reply(_) => {
        args.push("--no-session-persistence".into());
        (None, None)
      }
    };
    if let Kind::New(_, model) | Kind::Reply(model) = kind {
      // Models without effort levels offer only "off", which Claude Code has no flag for.
      let flags = model.flags("--effort");
      args.extend(flags.chunks(2).filter(|flag| flag[1] != "off").flatten().cloned());
    }
    let adapter = Adapter { session, wsl, state: None, thinking, parts: Vec::new(), block: 0, asked: HashMap::new(), aborted: false };
    (adapter, args)
  }

  pub fn command(&mut self, record: Value) -> Out {
    let mut out = Out::default();
    match record["type"].as_str() {
      Some("prompt") => {
        self.aborted = false;
        out.write.push(json!({ "type": "user", "message": { "role": "user", "content": record["message"] } }));
        out.emit.push(json!({ "type": "agent_start" }));
      }
      Some("abort") => {
        self.aborted = true;
        out.write.push(json!({ "type": "control_request", "request_id": "abort", "request": { "subtype": "interrupt" } }));
      }
      Some("get_state") => out.emit.extend(self.state.clone()),
      Some("get_messages") => {
        let read = self.session.as_deref().ok_or_else(|| "This reply has no session".to_string()).and_then(|id| transcript(id, self.wsl));
        out.emit.push(match read {
          Ok(text) => response("get_messages", json!({ "messages": history(&text) })),
          Err(error) => failed("get_messages", &format!("Couldn't read the session: {error}")),
        });
      }
      Some("extension_ui_response") => {
        let id = record["id"].as_str().unwrap_or("");
        if let Some(input) = self.asked.remove(id) {
          let answer = match record["confirmed"] == true {
            true => json!({ "behavior": "allow", "updatedInput": input }),
            false => json!({ "behavior": "deny", "message": "The user declined this tool call." }),
          };
          out.write.push(json!({ "type": "control_response", "response": { "subtype": "success", "request_id": id, "response": answer } }));
        }
      }
      _ => {}
    }
    out
  }

  pub fn record(&mut self, record: Value) -> Out {
    let mut out = Out::default();
    // Subagents' work stays inside the tool call that started them.
    if record["parent_tool_use_id"].is_string() {
      return out;
    }
    match record["type"].as_str() {
      Some("system") if record["subtype"] == "init" => {
        let thinking = self.thinking.as_deref().unwrap_or("default");
        let state = response("get_state", json!({ "model": { "name": record["model"] }, "thinkingLevel": thinking }));
        self.state = Some(state.clone());
        out.emit.push(state);
      }
      Some("stream_event") => out.emit.extend(self.stream(&record["event"])),
      // One record per finished block, before the stream says the block stopped.
      Some("assistant") => {
        for block in record["message"]["content"].as_array().into_iter().flatten() {
          let part = part(block);
          if part["type"] == "toolCall" {
            out.emit.push(update(json!({ "type": "toolcall_end", "contentIndex": self.block, "toolCall": part })));
          }
          if self.parts.len() <= self.block {
            self.parts.resize(self.block + 1, json!({ "type": "thinking" }));
          }
          self.parts[self.block] = part;
        }
      }
      Some("user") => out.emit.extend(user(&record["message"]["content"]).into_iter().flat_map(whole)),
      Some("control_request") => {
        let (id, request) = (record["request_id"].as_str().unwrap_or(""), &record["request"]);
        if request["subtype"] == "can_use_tool" {
          let input = &request["input"];
          let detail = input["command"].as_str().or(request["description"].as_str()).unwrap_or("");
          let tool = request["display_name"].as_str().or(request["tool_name"].as_str()).unwrap_or("a tool");
          out.emit.push(confirm(id, &format!("Allow {tool}?"), detail));
          self.asked.insert(id.to_string(), input.clone());
        } else {
          let error = "Pluck can't answer this request";
          out.write.push(json!({ "type": "control_response", "response": { "subtype": "error", "request_id": id, "error": error } }));
        }
      }
      Some("result") => {
        if record["is_error"] == true && !self.aborted {
          let errors = record["errors"].as_array().map(|errors| errors.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; "));
          let error = record["result"].as_str().map(String::from).or(errors).unwrap_or_else(|| "Claude Code failed".into());
          out.emit.push(failed("prompt", &error));
        }
        out.emit.push(json!({ "type": "agent_settled" }));
      }
      _ => {}
    }
    out
  }

  /// Pi's stream events for one of the Messages API's.
  fn stream(&mut self, event: &Value) -> Vec<Value> {
    let index = &event["index"];
    match event["type"].as_str() {
      Some("message_start") => {
        self.parts.clear();
        self.block = 0;
        vec![json!({ "type": "message_start", "message": { "role": "assistant", "content": [] } })]
      }
      Some("content_block_start") => {
        self.block = index.as_u64().unwrap_or(0) as usize;
        let block = &event["content_block"];
        match block["type"].as_str() {
          Some("text") => vec![update(json!({ "type": "text_start", "contentIndex": index }))],
          Some("thinking") => vec![update(json!({ "type": "thinking_start", "contentIndex": index }))],
          Some("tool_use" | "server_tool_use") => {
            let (name, _) = tool(block["name"].as_str().unwrap_or(""), &json!({}));
            vec![update(json!({ "type": "toolcall_start", "contentIndex": index, "id": block["id"], "toolName": name }))]
          }
          _ => Vec::new(),
        }
      }
      Some("content_block_delta") if event["delta"]["type"] == "text_delta" => {
        vec![update(json!({ "type": "text_delta", "contentIndex": index, "delta": event["delta"]["text"] }))]
      }
      Some("message_stop") => {
        let content = std::mem::take(&mut self.parts);
        vec![json!({ "type": "message_end", "message": { "role": "assistant", "content": content } })]
      }
      _ => Vec::new(),
    }
  }
}

/// One block of an assistant message as a Pi part.
fn part(block: &Value) -> Value {
  match block["type"].as_str() {
    Some("text") => text(block["text"].as_str().unwrap_or("")),
    Some("tool_use" | "server_tool_use") => {
      let (name, arguments) = tool(block["name"].as_str().unwrap_or(""), &block["input"]);
      json!({ "type": "toolCall", "id": block["id"], "name": name, "arguments": arguments })
    }
    // Thinking and search results aren't shown, but keep their place in the message.
    _ => json!({ "type": "thinking" }),
  }
}

/// Claude Code's tools by the names pluck shows steps for, with `path` where they take `file_path`.
fn tool(name: &str, input: &Value) -> (String, Value) {
  let known = match name {
    "Bash" => "bash",
    "Read" => "read",
    "Edit" | "MultiEdit" | "NotebookEdit" => "edit",
    "Write" => "write",
    "Grep" => "grep",
    "Glob" => "find",
    "WebSearch" | "web_search" => "web_search",
    "WebFetch" | "web_fetch" => "fetch_content",
    other => other,
  };
  let mut arguments = input.clone();
  if let Some(path) = input.get("file_path").or(input.get("notebook_path")) {
    arguments["path"] = path.clone();
  }
  (known.to_string(), arguments)
}

/// A user message as Pi messages: the prompt, or the results of the tools the reply called.
fn user(content: &Value) -> Vec<Value> {
  if let Some(prompt) = content.as_str() {
    return vec![json!({ "role": "user", "content": prompt })];
  }
  let results = content.as_array().into_iter().flatten().filter(|block| block["type"] == "tool_result");
  results
    .map(|result| {
      let output = match &result["content"] {
        Value::String(output) => output.clone(),
        blocks => blocks.as_array().into_iter().flatten().filter_map(|block| block["text"].as_str()).collect::<Vec<_>>().join("\n"),
      };
      json!({ "role": "toolResult", "toolCallId": result["tool_use_id"], "content": [text(&output)], "isError": result["is_error"] == true })
    })
    .collect()
}

/// A session's messages from its transcript, one JSON entry per line. An assistant message is
/// written once per block, so blocks of the same message are joined.
fn history(transcript: &str) -> Vec<Value> {
  let mut messages: Vec<Value> = Vec::new();
  let mut last_id = Value::Null;
  for entry in transcript.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()) {
    if entry["isSidechain"] == true || entry["isMeta"] == true {
      continue;
    }
    let message = &entry["message"];
    match entry["type"].as_str() {
      Some("user") => {
        messages.extend(user(&message["content"]));
        last_id = Value::Null;
      }
      Some("assistant") => {
        let parts = message["content"].as_array().into_iter().flatten().map(part);
        match messages.last_mut() {
          Some(last) if message["id"] == last_id && !last_id.is_null() => last["content"].as_array_mut().expect("assistant content is a list").extend(parts),
          _ => messages.push(json!({ "role": "assistant", "content": parts.collect::<Vec<_>>() })),
        }
        last_id = message["id"].clone();
      }
      _ => {}
    }
  }
  messages
}

/// The session's transcript. Claude Code names each project folder after its path, so the session
/// is found by its id in all of them.
fn transcript(id: &str, wsl: bool) -> Result<String, String> {
  #[cfg(windows)]
  if wsl {
    return super::wsl_output(r#"cat "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/"$0".jsonl"#, id);
  }
  let _ = wsl;
  let projects = config_folder("CLAUDE_CONFIG_DIR", ".claude").join("projects");
  let file = fs::read_dir(projects).ok().into_iter().flatten().flatten().map(|project| project.path().join(format!("{id}.jsonl"))).find(|file| file.exists());
  let file = file.ok_or("Claude Code has no transcript for it")?;
  fs::read_to_string(file).map_err(|error| error.to_string())
}

/// The models Claude Code offers, as it tells an SDK host that starts it.
pub fn models(folder: &str, wsl: bool) -> Result<Value, String> {
  let (_, args) = Adapter::open(&Kind::Reply(&Default::default()), wsl);
  let mut child = spawn(Harness::Claude, folder, wsl, &args).map_err(|error| error.to_string())?;
  let mut stdin = child.stdin.take();
  let initialize = json!({ "type": "control_request", "request_id": "models", "request": { "subtype": "initialize" } });
  writeln!(stdin.as_mut().expect("stdin is piped"), "{initialize}").map_err(|error| error.to_string())?;
  let mut answer = None;
  let reason = read_records(Harness::Claude, &mut child, |record| {
    if record["type"] == "control_response" {
      answer = Some(record["response"].clone());
      stdin = None;
    }
  });
  let answer = answer.ok_or(reason)?;
  if answer["subtype"] == "error" {
    return Err(answer["error"].as_str().unwrap_or("Claude Code couldn't list its models").to_string());
  }
  Ok(catalog(&answer["response"]["models"]))
}

/// "default" stands for one of the other models, which new sessions start with.
fn catalog(offered: &Value) -> Value {
  let offered = offered.as_array().cloned().unwrap_or_default();
  let default = offered.iter().find(|model| model["value"] == "default").map(|model| model["resolvedModel"].clone());
  let models: Vec<Value> = offered.iter().filter(|model| model["value"] != "default").cloned().collect();
  let start = default.and_then(|resolved| models.iter().find(|model| model["resolvedModel"] == resolved)).map(|model| json!({ "model": model["value"] }));
  let models = models
    .iter()
    .map(|model| {
      let levels = model["supportedEffortLevels"].as_array().filter(|levels| !levels.is_empty()).cloned().unwrap_or_else(|| vec![json!("off")]);
      json!({ "id": model["value"], "name": model["displayName"], "reasoning": model["supportsEffort"] == true, "thinkingLevels": levels })
    })
    .collect::<Vec<_>>();
  json!({ "models": models, "settings": null, "start": start })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::agent::Model;

  fn session() -> Adapter {
    Adapter::open(&Kind::New("s", &Model::default()), false).0
  }

  fn records(adapter: &mut Adapter, lines: &[Value]) -> Vec<Value> {
    lines.iter().flat_map(|line| adapter.record(line.clone()).emit).collect()
  }

  #[test]
  // agent.stream
  fn agent_stream_a_reply_streams_its_text_and_tool_calls_as_pi_records() {
    let mut adapter = session();
    let emitted = records(
      &mut adapter,
      &[
        json!({ "type": "stream_event", "event": { "type": "message_start" } }),
        json!({ "type": "stream_event", "event": { "type": "content_block_start", "index": 0, "content_block": { "type": "text" } } }),
        json!({ "type": "stream_event", "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "Hi" } } }),
        json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "Hi" }] } }),
        json!({ "type": "stream_event", "event": { "type": "content_block_start", "index": 1, "content_block": { "type": "tool_use", "id": "t", "name": "Read" } } }),
        json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "id": "t", "name": "Read", "input": { "file_path": "a.md" } }] } }),
        json!({ "type": "stream_event", "event": { "type": "message_stop" } }),
        json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "t", "content": "text" }] } }),
        json!({ "type": "result", "is_error": false }),
      ],
    );
    let types: Vec<_> = emitted.iter().map(|record| record["type"].as_str().unwrap()).collect();
    assert_eq!(types, ["message_start", "message_update", "message_update", "message_update", "message_update", "message_end", "message_start", "message_end", "agent_settled"]);
    assert_eq!(emitted[2]["assistantMessageEvent"]["delta"], "Hi");
    assert_eq!(emitted[3]["assistantMessageEvent"]["toolName"], "read");
    let content = &emitted[5]["message"]["content"];
    assert_eq!(content[0]["text"], "Hi");
    assert_eq!(content[1]["arguments"]["path"], "a.md");
    assert_eq!(emitted[7]["message"], json!({ "role": "toolResult", "toolCallId": "t", "content": [text("text")], "isError": false }));
  }

  #[test]
  // agent.dialogs
  fn agent_dialogs_a_permission_prompt_is_asked_and_answered_with_the_tool_input() {
    let mut adapter = session();
    let request = json!({ "type": "control_request", "request_id": "r", "request": { "subtype": "can_use_tool", "tool_name": "Bash", "input": { "command": "ls" } } });
    let asked = adapter.record(request).emit;
    assert_eq!(asked, [confirm("r", "Allow Bash?", "ls")]);
    let answer = adapter.command(json!({ "type": "extension_ui_response", "id": "r", "confirmed": true })).write;
    assert_eq!(answer[0]["response"]["response"], json!({ "behavior": "allow", "updatedInput": { "command": "ls" } }));
  }

  #[test]
  // agent.stop
  fn agent_stop_an_aborted_run_settles_without_an_error() {
    let mut adapter = session();
    adapter.command(json!({ "type": "abort" }));
    let emitted = adapter.record(json!({ "type": "result", "is_error": true, "subtype": "error_during_execution" })).emit;
    assert_eq!(emitted, [json!({ "type": "agent_settled" })]);
  }

  #[test]
  // agent.reopen
  fn agent_reopen_the_transcript_joins_blocks_of_one_message() {
    let transcript = [
      json!({ "type": "user", "message": { "content": "Explain" } }),
      json!({ "type": "assistant", "message": { "id": "m", "content": [{ "type": "text", "text": "Let me look" }] } }),
      json!({ "type": "assistant", "message": { "id": "m", "content": [{ "type": "tool_use", "id": "t", "name": "Bash", "input": { "command": "ls" } }] } }),
      json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "t", "content": [{ "type": "text", "text": "a" }] }] } }),
      json!({ "type": "user", "isMeta": true, "message": { "content": "caveat" } }),
      json!({ "type": "assistant", "message": { "id": "n", "content": [{ "type": "text", "text": "Done" }] } }),
    ]
    .map(|entry| entry.to_string())
    .join("\n");
    let messages = history(&transcript);
    let roles: Vec<_> = messages.iter().map(|message| message["role"].as_str().unwrap()).collect();
    assert_eq!(roles, ["user", "assistant", "toolResult", "assistant"]);
    assert_eq!(messages[1]["content"][1]["name"], "bash");
  }

  #[test]
  // settings.agent-models
  fn settings_agent_models_default_names_the_model_it_stands_for() {
    let offered = json!([
      { "value": "default", "resolvedModel": "claude-opus-5-5" },
      { "value": "opus", "resolvedModel": "claude-opus-5-5", "displayName": "Opus 5.5", "supportsEffort": true, "supportedEffortLevels": ["low", "high"] },
      { "value": "claude-haiku-4-5", "resolvedModel": "claude-haiku-4-5", "displayName": "Haiku 4.5" },
    ]);
    let catalog = catalog(&offered);
    assert_eq!(catalog["start"], json!({ "model": "opus" }));
    assert_eq!(catalog["models"][0]["thinkingLevels"], json!(["low", "high"]));
    assert_eq!(catalog["models"][1]["thinkingLevels"], json!(["off"]));
  }
}
