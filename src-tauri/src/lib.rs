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
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
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

/// What the home screen shows; read again each time it gets focus.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HomeState {
  version: String,
  hotkey: String,
  config_dir: String,
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
    .plugin(tauri_plugin_single_instance::init(|app, _, _| show_home(app)))
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
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(Mutex::new(Session::default()))
    .invoke_handler(tauri::generate_handler![
      run_action,
      dismiss,
      home_state,
      set_hotkey,
      pause_hotkey,
      open_config_folder,
      edit_config
    ])
    .on_window_event(|window, event| match event {
      WindowEvent::Focused(false) if window.label() == "menu" => {
        let _ = window.hide();
      }
      WindowEvent::CloseRequested { api, .. } => {
        api.prevent_close();
        let _ = window.hide();
      }
      _ => {}
    })
    .setup(|app| {
      let hotkey = config::hotkey(&config_dir(app.handle()));
      if let Err(error) = app.global_shortcut().register(hotkey.as_str()) {
        notify(app.handle(), "Pluck has no hotkey", &format!("{hotkey} couldn't be registered: {error}"));
      }
      add_tray(app.handle(), &hotkey)?;
      show_home(app.handle());
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

  // The hotkey alone, with nothing selected, opens the home screen.
  let text = selection.unwrap_or_default();
  if text.is_empty() {
    return show_home(app);
  }
  let config = config::load(&config_dir(app));
  let opened = Opened {
    text,
    app: target.app.clone(),
    title: target.title.clone(),
    actions: config.actions,
    problems: config.problems,
  };
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

#[tauri::command]
fn home_state(app: AppHandle) -> HomeState {
  let dir = config_dir(&app);
  let config = config::load(&dir);
  HomeState {
    version: app.package_info().version.to_string(),
    hotkey: config::hotkey(&dir),
    config_dir: dir.display().to_string(),
    actions: config.actions,
    problems: config.problems,
  }
}

/// Registers `hotkey` in place of the current one and saves it, or keeps the current one.
#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
  let dir = config_dir(&app);
  let shortcuts = app.global_shortcut();
  let _ = shortcuts.unregister_all();
  if shortcuts.register(hotkey.as_str()).is_err() {
    let _ = shortcuts.register(config::hotkey(&dir).as_str());
    return Err("That hotkey is taken by the system or another app.".into());
  }
  config::save_hotkey(&dir, &hotkey).map_err(|error| format!("Couldn't save the hotkey: {error}"))?;
  if let Some(tray) = app.tray_by_id(TRAY) {
    let _ = tray.set_tooltip(Some(tooltip(&hotkey)));
  }
  Ok(())
}

/// Registered hotkeys never reach the page, so recording a new one turns the current one off.
#[tauri::command]
fn pause_hotkey(app: AppHandle) {
  let _ = app.global_shortcut().unregister_all();
}

#[tauri::command]
fn open_config_folder(app: AppHandle) -> Result<(), String> {
  app.opener().open_path(config_dir(&app).to_string_lossy(), None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn edit_config(app: AppHandle) -> Result<(), String> {
  let file = config_dir(&app).join("pluck.toml");
  app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|error| error.to_string())
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

fn show_home(app: &AppHandle) {
  let Some(window) = app.get_webview_window("home") else { return };
  let _ = window.unminimize();
  let _ = window.show();
  let _ = window.set_focus();
}

const TRAY: &str = "tray";

fn tooltip(hotkey: &str) -> String {
  format!("Pluck ({hotkey})")
}

/// A click opens the home screen; the right-click menu also has Quit.
fn add_tray(app: &AppHandle, hotkey: &str) -> tauri::Result<()> {
  let home = MenuItem::with_id(app, "home", "Open Pluck", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  TrayIconBuilder::with_id(TRAY)
    .icon(app.default_window_icon().expect("the app has an icon").clone())
    .tooltip(tooltip(hotkey))
    .menu(&Menu::with_items(app, &[&home, &quit])?)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "home" => show_home(app),
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
        show_home(tray.app_handle());
      }
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
