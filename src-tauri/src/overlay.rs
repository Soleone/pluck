//! The overlay: cards at the bottom of the screen for actions running in the background and for
//! anything pluck has to say outside its windows. It takes the place of the OS's notifications.

use crate::action;
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};

const WIDTH: f64 = 380.0;
/// Space between the cards and the bottom of the work area, in logical pixels.
const MARGIN: f64 = 16.0;
/// A run that finishes sooner shows only its result, with no spinner before it.
const SPINNER_DELAY: Duration = Duration::from_millis(600);

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
  Running,
  Done,
  Failed,
  /// Stopped from its card, which goes away.
  Stopped,
}

#[derive(Clone, Serialize)]
pub struct Card {
  id: u32,
  title: String,
  text: String,
  status: Status,
  /// Running scripts can be stopped; agent replies can't yet.
  stoppable: bool,
}

/// `pid` is the script's process, for stopping it. `text` is the latest progress, kept until the
/// card shows.
struct Run {
  title: String,
  pid: Option<u32>,
  text: String,
  shown: bool,
}

#[derive(Default)]
struct Cards {
  next_id: u32,
  /// Cards shown before the overlay's page listens wait here.
  ready: bool,
  waiting: Vec<Card>,
  running: HashMap<u32, Run>,
}

#[derive(Default)]
pub struct Overlay(Mutex<Cards>);

/// Starts a run for `title`, shown as a running card once it outlasts `SPINNER_DELAY` unless it's
/// `quiet`, and returns its id for `progress` and `finish`.
pub fn start(app: &AppHandle, title: &str, pid: Option<u32>, quiet: bool) -> u32 {
  let overlay = app.state::<Overlay>();
  let mut cards = overlay.0.lock().unwrap();
  cards.next_id += 1;
  let id = cards.next_id;
  cards.running.insert(id, Run { title: title.into(), pid, text: String::new(), shown: false });
  if quiet {
    return id;
  }
  let app = app.clone();
  thread::spawn(move || {
    thread::sleep(SPINNER_DELAY);
    show_running(&app, id, |run| run.shown = true);
  });
  id
}

/// Shows `text` on a running card, unless it was stopped.
pub fn progress(app: &AppHandle, id: u32, text: &str) {
  show_running(app, id, |run| run.text = text.into());
}

fn show_running(app: &AppHandle, id: u32, change: impl FnOnce(&mut Run)) {
  let overlay = app.state::<Overlay>();
  let card = {
    let mut cards = overlay.0.lock().unwrap();
    let Some(run) = cards.running.get_mut(&id) else { return };
    change(run);
    if !run.shown {
      return;
    }
    Card { id, title: run.title.clone(), text: run.text.clone(), status: Status::Running, stoppable: run.pid.is_some() }
  };
  emit(app, card);
}

/// Turns a running card into its result. A run stopped from its card has nothing to show.
pub fn finish(app: &AppHandle, id: u32, result: Result<String, String>) {
  let overlay = app.state::<Overlay>();
  let Some(run) = overlay.0.lock().unwrap().running.remove(&id) else { return };
  let (status, text) = match result {
    Ok(text) => (Status::Done, text),
    Err(error) => (Status::Failed, error),
  };
  emit(app, Card { id, title: run.title, text, status, stoppable: false });
}

/// Shows a problem on its own card.
pub fn problem(app: &AppHandle, title: &str, text: &str) {
  let id = start(app, title, None, true);
  finish(app, id, Err(text.into()));
}

fn emit(app: &AppHandle, card: Card) {
  let overlay = app.state::<Overlay>();
  let mut cards = overlay.0.lock().unwrap();
  if cards.ready {
    let _ = app.emit_to("overlay", "pluck://card", card);
  } else {
    cards.waiting.push(card);
  }
}

/// The overlay's page listens now, so it gets the cards shown before.
#[tauri::command]
pub fn overlay_ready(app: AppHandle, overlay: State<Overlay>) {
  let mut cards = overlay.0.lock().unwrap();
  cards.ready = true;
  for card in cards.waiting.drain(..) {
    let _ = app.emit_to("overlay", "pluck://card", card);
  }
}

/// Ends a running script and everything it started.
#[tauri::command]
pub fn stop_run(app: AppHandle, overlay: State<Overlay>, id: u32) {
  let mut cards = overlay.0.lock().unwrap();
  let Some(&Run { pid: Some(pid), .. }) = cards.running.get(&id) else { return };
  let run = cards.running.remove(&id).expect("it was just found");
  drop(cards);
  action::kill(pid);
  let _ = app.emit_to("overlay", "pluck://card", Card { id, title: run.title, text: String::new(), status: Status::Stopped, stoppable: false });
}

/// Sizes the overlay to its cards, `height` logical pixels, centered at the bottom of the screen
/// the menu was on. With no cards it hides.
#[tauri::command]
pub fn fit_overlay(app: AppHandle, height: f64) {
  let Some(window) = app.get_webview_window("overlay") else { return };
  if height <= 0.0 {
    let _ = window.hide();
    return;
  }
  let _ = window.set_size(LogicalSize::new(WIDTH, height));
  let _ = place(&app, &window, height);
  let _ = window.show();
}

fn place(app: &AppHandle, window: &WebviewWindow, height: f64) -> tauri::Result<()> {
  let menu = app.get_webview_window("menu").expect("the menu window is in tauri.conf.json");
  let Some(monitor) = menu.current_monitor()?.or(app.primary_monitor()?) else { return Ok(()) };
  let scale = monitor.scale_factor();
  let area = monitor.work_area();
  let x = area.position.x + (area.size.width as i32 - (WIDTH * scale) as i32) / 2;
  let y = area.position.y + area.size.height as i32 - ((height + MARGIN) * scale) as i32;
  window.set_position(PhysicalPosition::new(x, y))
}
