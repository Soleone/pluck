mod action;
mod config;
mod grab;

use config::{Action, Output};
use grab::Target;
use serde::Serialize;
use std::{
  path::PathBuf,
  process::Child,
  sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
  },
  thread,
};
use tauri::{
  AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
  menu::{Menu, MenuItem},
  tray::TrayIconBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

/// What the menu shows for one trigger.
#[derive(Clone, Default, Serialize)]
struct Opened {
  text: String,
  app: String,
  title: String,
  actions: Vec<Action>,
  problems: Vec<String>,
}

#[derive(Default)]
struct Session {
  opened: Opened,
  target: Target,
}

/// Progress of a `show` action. `run` is chosen by the menu so it can ignore earlier runs.
#[derive(Clone, Serialize)]
struct RunEvent {
  run: u32,
  line: Option<String>,
  done: bool,
  error: Option<String>,
}

/// Holding the hotkey repeats it; one grab at a time.
static GRABBING: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      notify(app, "Pluck is already running", "Select text anywhere and press the hotkey.")
    }))
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _, event| {
          if event.state == ShortcutState::Pressed {
            let app = app.clone();
            thread::spawn(move || open_menu(&app));
          }
        })
        .build(),
    )
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .manage(Mutex::new(Session::default()))
    .invoke_handler(tauri::generate_handler![run_action, dismiss])
    .on_window_event(|window, event| match event {
      WindowEvent::Focused(false) => {
        let _ = window.hide();
      }
      WindowEvent::CloseRequested { api, .. } => {
        api.prevent_close();
        let _ = window.hide();
      }
      _ => {}
    })
    .setup(|app| {
      let hotkey = config::load(&config_dir(app.handle())).hotkey;
      if let Err(error) = app.global_shortcut().register(hotkey.as_str()) {
        notify(app.handle(), "Pluck has no hotkey", &format!("{hotkey} couldn't be registered: {error}"));
      }
      add_tray(app.handle(), &hotkey)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running pluck");
}

fn open_menu(app: &AppHandle) {
  let window = menu_window(app);
  if window.is_visible().unwrap_or(false) || GRABBING.swap(true, Ordering::SeqCst) {
    return;
  }
  let target = grab::target();
  let selection = grab::copy_selection();
  GRABBING.store(false, Ordering::SeqCst);

  let config = config::load(&config_dir(app));
  let mut problems = config.problems;
  let text = selection.unwrap_or_else(|error| {
    problems.push(error);
    String::new()
  });
  let opened = Opened { text, app: target.app.clone(), title: target.title.clone(), actions: config.actions, problems };
  let _ = window.emit("pluck://open", &opened);
  *app.state::<Mutex<Session>>().lock().unwrap() = Session { opened, target };

  let _ = place_at_cursor(&window);
  let _ = window.show();
  let _ = window.set_focus();
}

#[tauri::command]
fn run_action(app: AppHandle, session: State<Mutex<Session>>, id: String, run: u32) -> Result<(), String> {
  let (action, child) = {
    let session = session.lock().unwrap();
    let opened = &session.opened;
    let action = opened.actions.iter().find(|action| action.id == id).cloned().ok_or("Unknown action")?;
    let env = [("PLUCK_APP", opened.app.as_str()), ("PLUCK_TITLE", opened.title.as_str())];
    let child = action::spawn(&action.run, &config_dir(&app), &opened.text, &env).map_err(|error| error.to_string())?;
    (action, child)
  };
  match action.output {
    Output::Show => {
      thread::spawn(move || show(&app, child, run));
    }
    Output::Copy | Output::Notify => {
      hide_menu(&app);
      thread::spawn(move || finish_in_background(&app, &action, child));
    }
  }
  Ok(())
}

#[tauri::command]
fn dismiss(app: AppHandle) {
  hide_menu(&app);
}

fn show(app: &AppHandle, child: Child, run: u32) {
  let emit = |event: RunEvent| {
    let _ = app.emit("pluck://run", event);
  };
  let result = action::stream(child, |line| emit(RunEvent { run, line: Some(line), done: false, error: None }));
  emit(RunEvent { run, line: None, done: true, error: result.err() });
}

fn finish_in_background(app: &AppHandle, action: &Action, child: Child) {
  let failed = format!("{} failed", action.name);
  let stdout = match action::finish(child) {
    Ok(stdout) => stdout,
    Err(error) => return notify(app, &failed, &error),
  };
  if let Output::Copy = action.output {
    let copied = arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(stdout.trim_end_matches(['\r', '\n'])));
    return match copied {
      Ok(()) => notify(app, &action.name, "Copied"),
      Err(error) => notify(app, &failed, &error.to_string()),
    };
  }
  let first_line = stdout.lines().map(str::trim).find(|line| !line.is_empty());
  notify(app, &action.name, first_line.unwrap_or("Done"));
}

fn hide_menu(app: &AppHandle) {
  let _ = menu_window(app).hide();
  grab::focus(&app.state::<Mutex<Session>>().lock().unwrap().target);
}

/// Opens the menu at the cursor, shifted to stay inside the screen's work area.
fn place_at_cursor(window: &WebviewWindow) -> tauri::Result<()> {
  let cursor = window.cursor_position()?;
  let size = window.outer_size()?;
  let Some(monitor) = window.monitor_from_point(cursor.x, cursor.y)? else { return Ok(()) };
  let area = monitor.work_area();
  let right = area.position.x + area.size.width as i32 - size.width as i32;
  let bottom = area.position.y + area.size.height as i32 - size.height as i32;
  let x = (cursor.x as i32).min(right).max(area.position.x);
  let y = (cursor.y as i32).min(bottom).max(area.position.y);
  window.set_position(PhysicalPosition::new(x, y))
}

fn add_tray(app: &AppHandle, hotkey: &str) -> tauri::Result<()> {
  let folder = MenuItem::with_id(app, "folder", "Open config folder", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  TrayIconBuilder::new()
    .icon(app.default_window_icon().expect("the app has an icon").clone())
    .tooltip(format!("Pluck ({hotkey})"))
    .menu(&Menu::with_items(app, &[&folder, &quit])?)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "folder" => {
        let _ = app.opener().open_path(config_dir(app).to_string_lossy(), None::<&str>);
      }
      "quit" => app.exit(0),
      _ => {}
    })
    .build(app)?;
  Ok(())
}

fn notify(app: &AppHandle, title: &str, body: &str) {
  let _ = app.notification().builder().title(title).body(body).show();
}

fn menu_window(app: &AppHandle) -> WebviewWindow {
  app.get_webview_window("menu").expect("the menu window is in tauri.conf.json")
}

/// %APPDATA%\pluck on Windows, ~/Library/Application Support/pluck on macOS, ~/.config/pluck on Linux.
fn config_dir(app: &AppHandle) -> PathBuf {
  app.path().config_dir().expect("the OS has a config folder").join("pluck")
}
