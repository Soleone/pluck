mod action;
mod agent;
mod config;
mod grab;

use agent::{AgentSession, Agents, Model};
use config::{Action, AgentSettings, Output};
use grab::Target;
use serde::Serialize;
use std::{
  path::PathBuf,
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
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Starting with the system passes this, so pluck goes straight to the tray.
const AUTOSTARTED: &str = "--autostarted";

const WINDOW_STATE: StateFlags = StateFlags::SIZE.union(StateFlags::POSITION).union(StateFlags::MAXIMIZED);

/// Where the menu's text came from.
#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Source {
  #[default]
  Selection,
  /// Nothing was selected, so the clipboard stands in.
  Clipboard,
  /// Nothing was selected in a browser, so its address bar stands in.
  #[cfg_attr(not(windows), allow(dead_code))]
  AddressBar,
}

/// What the menu shows for one trigger.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
  text: String,
  source: Source,
  app: String,
  title: String,
  /// The page the text was copied from, when the browser says so.
  url: String,
  actions: Vec<Action>,
  problems: Vec<String>,
  /// The most recently active agent session, which agent actions can continue.
  last_session: Option<AgentSession>,
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
  agent: AgentSettings,
  /// "windows", "macos" or "linux".
  platform: &'static str,
  wsl: bool,
  browser_url: bool,
  autostart: bool,
}

/// Asks the agents window to send `prompt` from the menu, to `session` or else a new session.
/// A new session runs with `model` and `thinking`, where set.
#[derive(Clone, Serialize)]
struct AgentRequest {
  title: String,
  prompt: String,
  session: Option<String>,
  model: Option<String>,
  thinking: Option<String>,
}

#[derive(Default)]
struct Session {
  opened: Opened,
  target: Target,
}

/// Progress of a `show` or `replace` action. `run` is chosen by the menu so it can ignore earlier runs.
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
    .plugin(tauri_plugin_single_instance::init(|app, args, _| started(app, &args)))
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
    .plugin(tauri_plugin_autostart::Builder::new().args([AUTOSTARTED]).build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    // The menu opens at the cursor, so only home and agents come back where they were.
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(WINDOW_STATE)
        .with_denylist(&["menu"])
        .build(),
    )
    .manage(Mutex::new(Session::default()))
    .manage(Agents::default())
    .invoke_handler(tauri::generate_handler![
      run_action,
      ask,
      replace,
      dismiss,
      home_state,
      set_hotkey,
      set_wsl,
      set_autostart,
      set_browser_url,
      pick_folder,
      pause_hotkey,
      open_config_folder,
      open_url,
      edit_config,
      save_actions,
      set_agent_settings,
      agent_models,
      agent_sessions,
      agent_start,
      agent_send,
      agent_remove,
      show_agents
    ])
    .on_window_event(|window, event| match event {
      WindowEvent::Focused(false) if window.label() == "menu" => {
        let _ = window.hide();
      }
      WindowEvent::CloseRequested { api, .. } => {
        api.prevent_close();
        // The plugin only writes on a clean exit, which a Windows shutdown can skip.
        let _ = window.app_handle().save_window_state(WINDOW_STATE);
        let _ = window.hide();
      }
      _ => {}
    })
    .setup(|app| {
      let hotkey = config::settings(&config_dir(app.handle())).hotkey;
      // Wayland doesn't let apps grab keys; the window manager binds one to `pluck menu`.
      if cfg!(not(target_os = "linux"))
        && let Err(error) = app.global_shortcut().register(hotkey.as_str())
      {
        notify(app.handle(), "Pluck has no hotkey", &format!("{hotkey} couldn't be registered: {error}"));
      }
      add_tray(app.handle(), &hotkey)?;
      // Rewrites a login entry made before it carried the flag.
      let launch = app.autolaunch();
      if launch.is_enabled().unwrap_or(false) {
        let _ = launch.enable();
      }
      started(app.handle(), &std::env::args().collect::<Vec<_>>());
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running pluck");
}

/// `pluck menu` opens the menu, whether pluck was running or not; a start at login stays in the
/// tray; any other start opens home.
fn started(app: &AppHandle, args: &[String]) {
  match args.get(1).map(String::as_str) {
    Some("menu") => {
      let app = app.clone();
      thread::spawn(move || open_menu(&app));
    }
    Some(AUTOSTARTED) => {}
    _ => show_window(app, "home"),
  }
}

fn open_menu(app: &AppHandle) {
  let window = menu_window(app);
  if window.is_visible().unwrap_or(false) || GRABBING.swap(true, Ordering::SeqCst) {
    return;
  }
  let target = grab::target();
  let mut selection = grab::copy_selection().unwrap_or_default();
  let mut source = Source::Selection;
  #[cfg(windows)]
  if selection.text.is_empty() && grab::is_browser(&target.app) && config::settings(&config_dir(app)).browser_url {
    selection.url = grab::address_bar_url();
    selection.text = selection.url.clone();
    source = Source::AddressBar;
  }
  GRABBING.store(false, Ordering::SeqCst);

  // With nothing selected the clipboard stands in; with that empty too, home opens.
  if selection.text.is_empty() {
    selection.text = grab::clipboard_text();
    source = Source::Clipboard;
  }
  if selection.text.is_empty() {
    return show_window(app, "home");
  }
  let text = selection.text;
  let dir = config_dir(app);
  let config = config::load(&dir);
  let opened = Opened {
    text,
    source,
    app: target.app.clone(),
    title: target.title.clone(),
    url: selection.url,
    actions: config.actions,
    problems: config.problems,
    last_session: agent::sessions(&dir).into_iter().next(),
  };
  let _ = window.emit("pluck://open", &opened);
  *app.state::<Mutex<Session>>().lock().unwrap() = Session { opened, target };

  let _ = place_at_cursor(&window);
  let _ = window.show();
  let _ = window.set_focus();
}

/// Runs a menu action. Agent actions go to the last session when `continue_session` is set.
#[tauri::command]
fn run_action(
  app: AppHandle,
  session: State<Mutex<Session>>,
  id: String,
  run: u32,
  continue_session: bool,
) -> Result<(), String> {
  let (action, produce): (Action, Box<Produce>) = {
    let session = session.lock().unwrap();
    let opened = &session.opened;
    let action = opened.actions.iter().find(|action| action.id == id).cloned().ok_or("Unknown action")?;
    if let Some(prompt) = &action.agent {
      let prompt = agent_prompt(prompt, opened);
      if action.output == Output::Session {
        let request = AgentRequest {
          model: action.model.clone(),
          thinking: action.thinking.clone(),
          ..agent_request(title_of(&opened.text), prompt, opened, continue_session)
        };
        drop(session);
        send_to_agents(&app, request);
        return Ok(());
      }
      let (app, prompt_action) = (app.clone(), action.clone());
      (action, Box::new(move |on_text: &mut dyn FnMut(String)| one_off(&app, &prompt_action, &prompt, on_text)))
    } else {
      let mut env = vec![("PLUCK_APP", opened.app.as_str()), ("PLUCK_TITLE", opened.title.as_str())];
      if !opened.url.is_empty() {
        env.push(("PLUCK_URL", opened.url.as_str()));
      }
      let dir = config_dir(&app);
      let wsl = config::settings(&dir).wsl;
      let child = action::spawn(&action.run, wsl, &dir, &opened.text, &env).map_err(|error| error.to_string())?;
      (action, Box::new(move |on_line: &mut dyn FnMut(String)| action::stream(child, on_line)))
    }
  };
  match action.output {
    Output::Show | Output::Replace => {
      thread::spawn(move || show(&app, run, produce));
    }
    Output::Copy | Output::Notify => {
      hide_menu(&app);
      thread::spawn(move || finish_in_background(&app, &action, produce));
    }
    Output::Session => unreachable!("only prompts open a session, and they returned above"),
  }
  Ok(())
}

/// Asks the agent `question` about the text, from what was typed in the menu.
#[tauri::command]
fn ask(app: AppHandle, session: State<Mutex<Session>>, question: String, continue_session: bool) {
  let request = {
    let session = session.lock().unwrap();
    let opened = &session.opened;
    agent_request(title_of(&question), agent_prompt(&question, opened), opened, continue_session)
  };
  send_to_agents(&app, request);
}

/// Puts a `replace` action's result in place of the selection, or on the clipboard when nothing was
/// selected.
#[tauri::command]
fn replace(app: AppHandle, text: String) {
  let _ = menu_window(&app).hide();
  thread::spawn(move || {
    let session = app.state::<Mutex<Session>>();
    let session = session.lock().unwrap();
    let result = if session.opened.source != Source::Selection {
      grab::set_clipboard(&text)
    } else {
      grab::paste(&session.target, &text)
    };
    if let Err(error) = result {
      notify(&app, "Couldn't replace the text", &error);
    }
  });
}

fn agent_request(title: String, prompt: String, opened: &Opened, continue_session: bool) -> AgentRequest {
  let session = opened.last_session.as_ref().filter(|_| continue_session).map(|session| session.id.clone());
  AgentRequest { title, prompt, session, model: None, thinking: None }
}

/// Runs a prompt action that doesn't open a session: one reply from the agent.
fn one_off(app: &AppHandle, action: &Action, prompt: &str, on_text: impl FnMut(String)) -> Result<(), String> {
  let settings = config::settings(&config_dir(app));
  let model = session_model(action.model.clone(), action.thinking.clone(), &settings.agent);
  agent::reply(settings.agent.harness, &settings.agent.folder, settings.wsl, &model, prompt, on_text)
}

/// The model and thinking level a new session runs with: the ones given, else the agent settings'.
/// A model given without a level leaves the level to the harness, since it may not support the settings' one.
fn session_model(model: Option<String>, thinking: Option<String>, agent: &AgentSettings) -> Model {
  match model {
    Some(model) => Model { model: Some(model), thinking },
    None => Model { model: agent.model.clone(), thinking: thinking.or_else(|| agent.thinking.clone()) },
  }
}

fn send_to_agents(app: &AppHandle, request: AgentRequest) {
  hide_menu(app);
  let _ = app.emit_to("agents", "pluck://agent-request", request);
  show_window(app, "agents");
}

#[tauri::command]
fn dismiss(app: AppHandle) {
  hide_menu(&app);
}

#[tauri::command]
fn home_state(app: AppHandle) -> HomeState {
  let dir = config_dir(&app);
  let config = config::load(&dir);
  let settings = config::settings(&dir);
  HomeState {
    version: app.package_info().version.to_string(),
    hotkey: settings.hotkey,
    config_dir: dir.display().to_string(),
    actions: config.actions,
    problems: config.problems,
    agent: settings.agent,
    platform: if cfg!(windows) {
      "windows"
    } else if cfg!(target_os = "macos") {
      "macos"
    } else {
      "linux"
    },
    wsl: settings.wsl,
    browser_url: settings.browser_url,
    autostart: app.autolaunch().is_enabled().unwrap_or(false),
  }
}

#[tauri::command]
fn set_wsl(app: AppHandle, wsl: bool) -> Result<(), String> {
  let dir = config_dir(&app);
  let settings = config::Settings { wsl, ..config::settings(&dir) };
  config::save_settings(&dir, &settings).map_err(|error| format!("Couldn't save the setting: {error}"))
}

#[tauri::command]
fn set_browser_url(app: AppHandle, enabled: bool) -> Result<(), String> {
  let dir = config_dir(&app);
  let settings = config::Settings { browser_url: enabled, ..config::settings(&dir) };
  config::save_settings(&dir, &settings).map_err(|error| format!("Couldn't save the setting: {error}"))
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
  let launch = app.autolaunch();
  let changed = if enabled { launch.enable() } else { launch.disable() };
  changed.map_err(|error| format!("Couldn't change starting at login: {error}"))
}

/// A folder for agent sessions, as WSL names it when sessions run there. None when cancelled.
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
  let wsl = config::settings(&config_dir(&app)).wsl;
  let folder = app.dialog().file().blocking_pick_folder()?.into_path().ok()?;
  let folder = folder.display().to_string();
  Some(if wsl { agent::wsl_path(&folder) } else { folder })
}

/// Registers `hotkey` in place of the current one and saves it, or keeps the current one.
#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
  let dir = config_dir(&app);
  let mut settings = config::settings(&dir);
  let shortcuts = app.global_shortcut();
  let _ = shortcuts.unregister_all();
  if shortcuts.register(hotkey.as_str()).is_err() {
    let _ = shortcuts.register(settings.hotkey.as_str());
    return Err("That hotkey is taken by the system or another app.".into());
  }
  settings.hotkey = hotkey.clone();
  config::save_settings(&dir, &settings).map_err(|error| format!("Couldn't save the hotkey: {error}"))?;
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

/// Opens a link from a page in the default browser; the webview can't open windows of its own.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
  if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
    return Err(format!("Not a web link: {url}"));
  }
  app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn edit_config(app: AppHandle) -> Result<(), String> {
  let file = config_dir(&app).join("pluck.toml");
  app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|error| error.to_string())
}

/// The menu tab's edits: the whole action list, in menu order.
#[tauri::command]
fn save_actions(app: AppHandle, actions: Vec<Action>) -> Result<(), String> {
  config::save_actions(&config_dir(&app), &actions)
}

#[tauri::command]
fn set_agent_settings(app: AppHandle, agent: AgentSettings) -> Result<(), String> {
  let dir = config_dir(&app);
  let settings = config::Settings { agent, ..config::settings(&dir) };
  config::save_settings(&dir, &settings).map_err(|error| format!("Couldn't save the agent settings: {error}"))
}

/// Blocks for a few seconds while the harness starts, so it runs off the main thread.
#[tauri::command]
async fn agent_models(app: AppHandle) -> Result<serde_json::Value, String> {
  let settings = config::settings(&config_dir(&app));
  agent::models(settings.agent.harness, &settings.agent.folder, settings.wsl)
}

#[tauri::command]
fn agent_sessions(app: AppHandle) -> Vec<AgentSession> {
  agent::sessions(&config_dir(&app))
}

/// Runs session `id`, adding it to the list when it is new, with `model` and `thinking` where set,
/// else the agent settings'.
#[tauri::command]
fn agent_start(
  app: AppHandle,
  agents: State<Agents>,
  id: String,
  title: String,
  model: Option<String>,
  thinking: Option<String>,
) -> Result<(), String> {
  let dir = config_dir(&app);
  let (session, model) = match agent::sessions(&dir).into_iter().find(|session| session.id == id) {
    Some(session) => (session, None),
    None => {
      let settings = config::settings(&dir);
      let agent = settings.agent;
      let model = session_model(model, thinking, &agent);
      let session =
        AgentSession { id, title, folder: agent.folder, wsl: settings.wsl, harness: agent.harness, thread: None, last_active: agent::now() };
      let added = session.clone();
      agent::update_sessions(&dir, |sessions| sessions.insert(0, added))
        .map_err(|error| format!("Couldn't save the session list: {error}"))?;
      (session, Some(model))
    }
  };
  agent::start(&app, &agents, &dir, &session, model.as_ref()).map_err(|error| format!("Couldn't start {}: {error}", session.harness.name()))
}

#[tauri::command]
fn agent_send(app: AppHandle, agents: State<Agents>, id: String, record: serde_json::Value) -> Result<(), String> {
  agent::send(&app, &agents, &id, record)
}

#[tauri::command]
fn agent_remove(app: AppHandle, agents: State<Agents>, id: String) -> Result<(), String> {
  agent::remove(&agents, &config_dir(&app), &id).map_err(|error| format!("Couldn't save the session list: {error}"))
}

#[tauri::command]
fn show_agents(app: AppHandle) {
  show_window(&app, "agents");
}

/// The action's prompt, then the text and where it came from. The active window is named even
/// when the text came from the clipboard, since actions like bookmarking are about the window.
fn agent_prompt(prompt: &str, opened: &Opened) -> String {
  let mut window = if opened.title.is_empty() { opened.app.clone() } else { format!("{} ({})", opened.app, opened.title) };
  if !opened.url.is_empty() {
    window = format!("{window} at {}", opened.url);
  }
  let source = if opened.source == Source::Clipboard { format!("the clipboard, while {window} was active") } else { window };
  format!("{prompt}\n\nText from {source}:\n\n<text>\n{}\n</text>", opened.text)
}

/// The start of the text, on one line.
fn title_of(text: &str) -> String {
  let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
  match line.char_indices().nth(60) {
    Some((end, _)) => format!("{}…", &line[..end]),
    None => line,
  }
}

/// Runs an action's script or one-off prompt, passing on its output as it arrives.
type Produce = dyn FnOnce(&mut dyn FnMut(String)) -> Result<(), String> + Send;

/// Streams what `produce` passes on into the menu's panel.
fn show(app: &AppHandle, run: u32, produce: Box<Produce>) {
  let emit = |event: RunEvent| {
    let _ = app.emit("pluck://run", event);
  };
  let result = produce(&mut |line| emit(RunEvent { run, line: Some(line), done: false, error: None }));
  emit(RunEvent { run, line: None, done: true, error: result.err() });
}

/// Copies the output, or notifies with a script's first line or the agent's whole reply.
fn finish_in_background(app: &AppHandle, action: &Action, produce: Box<Produce>) {
  let failed = format!("{} failed", action.name);
  let mut output = String::new();
  if let Err(error) = produce(&mut |text| output.push_str(&text)) {
    return notify(app, &failed, &error);
  }
  if action.output == Output::Copy {
    return match grab::set_clipboard(output.trim_end_matches(['\r', '\n'])) {
      Ok(()) => notify(app, &action.name, "Copied"),
      Err(error) => notify(app, &failed, &error),
    };
  }
  let body = if action.agent.is_some() { output.trim() } else { output.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or("") };
  notify(app, &action.name, if body.is_empty() { "Done" } else { body });
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

fn show_window(app: &AppHandle, label: &str) {
  let Some(window) = app.get_webview_window(label) else { return };
  let _ = window.unminimize();
  let _ = window.show();
  let _ = window.set_focus();
}

const TRAY: &str = "tray";

fn tooltip(hotkey: &str) -> String {
  format!("Pluck ({hotkey})")
}

/// A click opens the home screen; the right-click menu also has Agents and Quit.
fn add_tray(app: &AppHandle, hotkey: &str) -> tauri::Result<()> {
  let home = MenuItem::with_id(app, "home", "Open Pluck", true, None::<&str>)?;
  let agents = MenuItem::with_id(app, "agents", "Agents", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  TrayIconBuilder::with_id(TRAY)
    .icon(app.default_window_icon().expect("the app has an icon").clone())
    .tooltip(tooltip(hotkey))
    .menu(&Menu::with_items(app, &[&home, &agents, &quit])?)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "home" | "agents" => show_window(app, event.id.as_ref()),
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
        show_window(tray.app_handle(), "home");
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
