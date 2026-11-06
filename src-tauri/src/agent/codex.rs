//! Codex's app server, speaking JSON-RPC. Codex names its threads itself, so a session keeps the
//! thread's id, and a resumed thread brings its history along.

use super::{confirm, failed, read_records, response, spawn, text, update, whole, Harness, Kind, Out};
use serde_json::{json, Value};
use std::{collections::HashMap, io::Write};

pub struct Adapter {
  thread: Option<String>,
  turn: Option<String>,
  /// Prompts sent before the thread was ready.
  waiting: Vec<Value>,
  /// The model, level and history the thread has, once Codex has opened it.
  state: Option<Value>,
  history: Option<Value>,
  /// get_messages came before the history.
  history_asked: bool,
  /// Approvals waiting for an answer: the request's id by the dialog's.
  asked: HashMap<String, Value>,
}

impl Adapter {
  /// The adapter and what opens the thread: Codex's handshake, then a new thread or the session's own.
  pub fn open(kind: &Kind) -> (Adapter, Vec<Value>) {
    let thread = match kind {
      Kind::Resume(session) if session.thread.is_some() => json!({ "id": "thread", "method": "thread/resume", "params": { "threadId": session.thread } }),
      Kind::New(_, model) | Kind::Reply(model) => start(model.model.as_deref(), model.thinking.as_deref(), matches!(kind, Kind::Reply(_))),
      // The session never got a thread, so it starts one.
      Kind::Resume(_) => start(None, None, false),
    };
    let adapter = Adapter { thread: None, turn: None, waiting: Vec::new(), state: None, history: None, history_asked: false, asked: HashMap::new() };
    (adapter, [handshake().to_vec(), vec![thread]].concat())
  }

  pub fn command(&mut self, record: Value) -> Out {
    let mut out = Out::default();
    match record["type"].as_str() {
      Some("prompt") => match &self.thread {
        Some(thread) => out.write.push(turn(thread, &record["message"])),
        None => self.waiting.push(record["message"].clone()),
      },
      Some("abort") => {
        if let (Some(thread), Some(turn)) = (&self.thread, &self.turn) {
          out.write.push(json!({ "id": "abort", "method": "turn/interrupt", "params": { "threadId": thread, "turnId": turn } }));
        }
      }
      Some("get_state") => out.emit.extend(self.state.clone()),
      Some("get_messages") => match &self.history {
        Some(messages) => out.emit.push(response("get_messages", json!({ "messages": messages }))),
        None => self.history_asked = true,
      },
      Some("extension_ui_response") => {
        if let Some(id) = self.asked.remove(record["id"].as_str().unwrap_or("")) {
          let decision = if record["confirmed"] == true { "accept" } else { "decline" };
          out.write.push(json!({ "id": id, "result": { "decision": decision } }));
        }
      }
      _ => {}
    }
    out
  }

  pub fn record(&mut self, record: Value) -> Out {
    let mut out = Out::default();
    let params = &record["params"];
    match (record.get("id"), record["method"].as_str()) {
      (Some(id), Some(method)) => self.request(id, method, params, &mut out),
      (Some(id), None) => self.answered(id, &record, &mut out),
      (None, Some("turn/started")) => {
        self.turn = params["turn"]["id"].as_str().map(String::from);
        out.emit.push(json!({ "type": "agent_start" }));
      }
      (None, Some("item/started")) => {
        let item = &params["item"];
        if item["type"] == "agentMessage" {
          out.emit.push(json!({ "type": "message_start", "message": { "role": "assistant", "content": [] } }));
          out.emit.push(update(json!({ "type": "text_start", "contentIndex": 0 })));
        } else if let [call, _result] = messages(item).as_slice() {
          out.emit.extend(whole(call.clone()));
        }
      }
      (None, Some("item/agentMessage/delta")) => out.emit.push(update(json!({ "type": "text_delta", "contentIndex": 0, "delta": params["delta"] }))),
      (None, Some("item/completed")) => {
        let item = &params["item"];
        match (item["type"].as_str(), messages(item).pop()) {
          (Some("agentMessage"), Some(message)) => out.emit.push(json!({ "type": "message_end", "message": message })),
          (_, Some(message)) => out.emit.extend(whole(message)),
          _ => {}
        }
      }
      (None, Some("turn/completed")) => {
        self.turn = None;
        let turn = &params["turn"];
        if turn["status"] == "failed" {
          out.emit.push(failed("prompt", turn["error"]["message"].as_str().unwrap_or("Codex failed")));
        }
        out.emit.push(json!({ "type": "agent_settled" }));
      }
      _ => {}
    }
    out
  }

  /// Codex asking pluck: approvals become yes or no questions, anything else is turned down.
  fn request(&mut self, id: &Value, method: &str, params: &Value, out: &mut Out) {
    let question = match method {
      "item/commandExecution/requestApproval" => Some(("Run this command?", params["command"].as_str().or(params["reason"].as_str()))),
      "item/fileChange/requestApproval" => Some(("Change these files?", params["reason"].as_str())),
      _ => None,
    };
    match question {
      Some((title, detail)) => {
        let key = id.to_string();
        out.emit.push(confirm(&key, title, detail.unwrap_or("")));
        self.asked.insert(key, id.clone());
      }
      None => out.write.push(json!({ "id": id, "error": { "code": -32601, "message": "Pluck can't answer this request" } })),
    }
  }

  /// Codex answering one of pluck's requests.
  fn answered(&mut self, id: &Value, record: &Value, out: &mut Out) {
    if let Some(error) = record["error"]["message"].as_str() {
      out.emit.push(failed("prompt", error));
      return;
    }
    if id != "thread" {
      return;
    }
    let result = &record["result"];
    let thread = result["thread"]["id"].as_str().map(String::from);
    let state = response("get_state", json!({ "model": { "name": result["model"] }, "thinkingLevel": result["reasoningEffort"].as_str().unwrap_or("default") }));
    let turns = result["thread"]["turns"].as_array().cloned().unwrap_or_default();
    let history: Vec<Value> = turns.iter().flat_map(|turn| turn["items"].as_array().cloned().unwrap_or_default()).flat_map(|item| messages(&item)).collect();
    out.emit.push(state.clone());
    if self.history_asked {
      out.emit.push(response("get_messages", json!({ "messages": history })));
    }
    if let Some(thread) = &thread {
      out.write.extend(self.waiting.drain(..).map(|message| turn(thread, &message)));
    }
    self.state = Some(state);
    self.history = Some(json!(history));
    self.thread = thread.clone();
    out.thread = thread;
  }
}

/// Codex's handshake, which comes before any other request.
fn handshake() -> [Value; 2] {
  let client = json!({ "name": "pluck", "version": env!("CARGO_PKG_VERSION") });
  [json!({ "id": "initialize", "method": "initialize", "params": { "clientInfo": client, "capabilities": null } }), json!({ "method": "initialized" })]
}

/// A new thread in the folder Codex runs in; a reply's isn't kept.
fn start(model: Option<&str>, thinking: Option<&str>, ephemeral: bool) -> Value {
  let config = thinking.map(|level| json!({ "model_reasoning_effort": level }));
  json!({ "id": "thread", "method": "thread/start", "params": { "model": model, "config": config, "ephemeral": ephemeral } })
}

fn turn(thread: &str, message: &Value) -> Value {
  json!({ "id": "turn", "method": "turn/start", "params": { "threadId": thread, "input": [{ "type": "text", "text": message, "text_elements": [] }] } })
}

/// A finished item as Pi messages: a prompt, a reply, or a tool call with its result.
fn messages(item: &Value) -> Vec<Value> {
  let call = |name: &str, arguments: Value| json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": item["id"], "name": name, "arguments": arguments }] });
  let result = |output: &str, failed: bool| json!({ "role": "toolResult", "toolCallId": item["id"], "content": [text(output)], "isError": failed });
  let done = item["status"] == "completed";
  match item["type"].as_str() {
    Some("userMessage") => {
      let prompt = item["content"].as_array().into_iter().flatten().filter_map(|input| input["text"].as_str()).collect::<Vec<_>>().join("\n");
      vec![json!({ "role": "user", "content": prompt })]
    }
    Some("agentMessage") => vec![json!({ "role": "assistant", "content": [text(item["text"].as_str().unwrap_or(""))] })],
    Some("commandExecution") => {
      // Codex wraps each command in a shell call; the parsed actions are what was asked for.
      let actions = item["commandActions"].as_array().into_iter().flatten().filter_map(|action| action["command"].as_str()).collect::<Vec<_>>();
      let command = if actions.is_empty() { item["command"].as_str().unwrap_or("").to_string() } else { actions.join(" && ") };
      let output = item["aggregatedOutput"].as_str().unwrap_or("");
      vec![call("bash", json!({ "command": command })), result(output, !done || item["exitCode"].as_i64().is_some_and(|code| code != 0))]
    }
    Some("fileChange") => {
      let changes = item["changes"].as_array().cloned().unwrap_or_default();
      let name = if changes.iter().all(|change| change["kind"]["type"] == "add") { "write" } else { "edit" };
      let paths = changes.iter().filter_map(|change| change["path"].as_str()).collect::<Vec<_>>().join(", ");
      let diff = changes.iter().filter_map(|change| change["diff"].as_str()).collect::<Vec<_>>().join("\n");
      vec![call(name, json!({ "path": paths })), result(&diff, !done)]
    }
    Some("mcpToolCall") => {
      let content = item["result"]["content"].as_array().into_iter().flatten().filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join("\n");
      let output = item["error"]["message"].as_str().map_or(content, String::from);
      vec![call(item["tool"].as_str().unwrap_or("tool"), item["arguments"].clone()), result(&output, !done)]
    }
    Some("webSearch") => vec![call("web_search", json!({ "query": item["query"] })), result("", false)],
    _ => Vec::new(),
  }
}

/// The models Codex offers; new sessions start with its default one.
pub fn models(folder: &str, wsl: bool) -> Result<Value, String> {
  let mut child = spawn(Harness::Codex, folder, wsl, &["app-server".into()]).map_err(|error| error.to_string())?;
  let mut stdin = child.stdin.take();
  let ask = stdin.as_mut().expect("stdin is piped");
  for record in [handshake().to_vec(), vec![json!({ "id": "models", "method": "model/list", "params": {} })]].concat() {
    writeln!(ask, "{record}").map_err(|error| error.to_string())?;
  }
  let mut answer = None;
  let reason = read_records(Harness::Codex, &mut child, |record| {
    if record["id"] == "models" {
      answer = Some(record);
      stdin = None;
    }
  });
  let answer = answer.ok_or(reason)?;
  if let Some(error) = answer["error"]["message"].as_str() {
    return Err(error.to_string());
  }
  Ok(catalog(&answer["result"]["data"]))
}

fn catalog(offered: &Value) -> Value {
  let offered: Vec<Value> = offered.as_array().into_iter().flatten().filter(|model| model["hidden"] != true).cloned().collect();
  let start = offered.iter().find(|model| model["isDefault"] == true).map(|model| json!({ "model": model["model"], "thinking": model["defaultReasoningEffort"] }));
  let models = offered
    .iter()
    .map(|model| {
      let levels: Vec<Value> = model["supportedReasoningEfforts"].as_array().into_iter().flatten().map(|option| option["reasoningEffort"].clone()).collect();
      let reasoning = !levels.is_empty();
      let levels = if reasoning { levels } else { vec![json!("off")] };
      json!({ "id": model["model"], "name": model["displayName"], "reasoning": reasoning, "thinkingLevels": levels, "thinking": model["defaultReasoningEffort"] })
    })
    .collect::<Vec<_>>();
  json!({ "models": models, "settings": null, "start": start })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::agent::Model;

  fn session() -> Adapter {
    Adapter::open(&Kind::New("s", &Model::default())).0
  }

  fn thread_opened() -> Value {
    json!({ "id": "thread", "result": { "thread": { "id": "th", "turns": [] }, "model": "gpt", "reasoningEffort": "low" } })
  }

  #[test]
  // agent.new
  fn agent_new_a_prompt_waits_for_the_thread_and_the_thread_is_kept() {
    let mut adapter = session();
    assert!(adapter.command(json!({ "type": "prompt", "message": "Hi" })).write.is_empty());
    let out = adapter.record(thread_opened());
    assert_eq!(out.thread.as_deref(), Some("th"));
    assert_eq!(out.write, [turn("th", &json!("Hi"))]);
    assert_eq!(out.emit[0]["data"]["model"]["name"], "gpt");
  }

  #[test]
  // agent.stream
  fn agent_stream_items_stream_as_pi_records() {
    let mut adapter = session();
    adapter.record(thread_opened());
    let command = json!({ "type": "commandExecution", "id": "c", "command": "bash -lc ls", "commandActions": [{ "command": "ls" }], "status": "completed", "aggregatedOutput": "a", "exitCode": 0 });
    let lines = [
      json!({ "method": "turn/started", "params": { "turn": { "id": "t" } } }),
      json!({ "method": "item/started", "params": { "item": { "type": "agentMessage", "id": "m" } } }),
      json!({ "method": "item/agentMessage/delta", "params": { "delta": "Hi" } }),
      json!({ "method": "item/completed", "params": { "item": { "type": "agentMessage", "id": "m", "text": "Hi" } } }),
      json!({ "method": "item/started", "params": { "item": command } }),
      json!({ "method": "item/completed", "params": { "item": command } }),
      json!({ "method": "turn/completed", "params": { "turn": { "status": "completed" } } }),
    ];
    let emitted: Vec<Value> = lines.into_iter().flat_map(|line| adapter.record(line).emit).collect();
    let types: Vec<_> = emitted.iter().map(|record| record["type"].as_str().unwrap()).collect();
    assert_eq!(types, ["agent_start", "message_start", "message_update", "message_update", "message_end", "message_start", "message_end", "message_start", "message_end", "agent_settled"]);
    assert_eq!(emitted[4]["message"]["content"][0]["text"], "Hi");
    assert_eq!(emitted[6]["message"]["content"][0]["arguments"]["command"], "ls");
    assert_eq!(emitted[8]["message"]["content"][0]["text"], "a");
  }

  #[test]
  // agent.dialogs
  fn agent_dialogs_an_approval_is_asked_and_answered() {
    let mut adapter = session();
    let asked = adapter.record(json!({ "id": 7, "method": "item/commandExecution/requestApproval", "params": { "command": "rm x" } })).emit;
    assert_eq!(asked, [confirm("7", "Run this command?", "rm x")]);
    let answer = adapter.command(json!({ "type": "extension_ui_response", "id": "7", "confirmed": false })).write;
    assert_eq!(answer, [json!({ "id": 7, "result": { "decision": "decline" } })]);
  }

  #[test]
  // agent.reopen
  fn agent_reopen_a_resumed_thread_brings_its_history() {
    let mut adapter = session();
    adapter.command(json!({ "type": "get_messages" }));
    let items = json!([{ "type": "userMessage", "content": [{ "type": "text", "text": "Hi" }] }, { "type": "agentMessage", "text": "Hello" }]);
    let opened = json!({ "id": "thread", "result": { "thread": { "id": "th", "turns": [{ "items": items }] }, "model": "gpt" } });
    let emitted = adapter.record(opened).emit;
    let messages = &emitted[1]["data"]["messages"];
    assert_eq!(messages[0], json!({ "role": "user", "content": "Hi" }));
    assert_eq!(messages[1]["content"][0]["text"], "Hello");
  }
}
