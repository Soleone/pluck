//! Reading the selection and context from the app that was active when the hotkey was pressed,
//! and pasting into it.

use platform::Window;
#[cfg(not(target_os = "linux"))]
use std::{thread::sleep, time::Duration};

/// The window pluck was triggered from, so focus can go back to it.
#[derive(Default)]
pub struct Target {
  window: Window,
  pub app: String,
  pub title: String,
}

/// The selected text, and the page it was copied from when the browser says so.
#[derive(Default)]
pub struct Selection {
  pub text: String,
  pub url: String,
}

pub use platform::{clipboard_text, focus, target};
#[cfg(target_os = "linux")]
pub use platform::{copy_selection, paste, set_clipboard};

#[cfg(not(target_os = "linux"))]
pub fn set_clipboard(text: &str) -> Result<(), String> {
  arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(text)).map_err(|error| error.to_string())
}

/// Copies the selection with the copy shortcut and puts the previous clipboard text back. An
/// unchanged clipboard means nothing was selected. Only text survives the round trip.
#[cfg(not(target_os = "linux"))]
pub fn copy_selection() -> Result<Selection, String> {
  let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
  let previous = clipboard.get_text().ok();
  let before = platform::change_count();

  platform::wait_for_modifiers_released();
  platform::send_shortcut(platform::KEY_C);
  let copied = (0..50).any(|_| {
    sleep(Duration::from_millis(10));
    before != platform::change_count()
  });
  if !copied {
    return Ok(Selection::default());
  }

  let selection = Selection { text: clipboard.get_text().unwrap_or_default(), url: platform::source_url() };
  restore(&mut clipboard, previous)?;
  Ok(selection)
}

/// Puts `text` in place of the target's selection by pasting it, then gives the clipboard back.
#[cfg(not(target_os = "linux"))]
pub fn paste(target: &Target, text: &str) -> Result<(), String> {
  let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
  let previous = clipboard.get_text().ok();
  clipboard.set_text(text).map_err(|error| error.to_string())?;
  focus(target);
  platform::wait_for_modifiers_released();
  platform::send_shortcut(platform::KEY_V);
  // The app reads the clipboard after the keys arrive; restoring sooner would paste the old text.
  sleep(Duration::from_millis(300));
  restore(&mut clipboard, previous)
}

#[cfg(not(target_os = "linux"))]
fn restore(clipboard: &mut arboard::Clipboard, previous: Option<String>) -> Result<(), String> {
  let restored = match previous {
    Some(previous) => clipboard.set_text(previous),
    None => clipboard.clear(),
  };
  restored.map_err(|error| format!("Couldn't restore the clipboard: {error}"))
}

#[cfg(not(target_os = "linux"))]
fn arboard_text() -> String {
  arboard::Clipboard::new().and_then(|mut clipboard| clipboard.get_text()).unwrap_or_default()
}

#[cfg(windows)]
mod platform {
  use super::Target;
  use std::{mem::size_of, thread::sleep, time::Duration};
  use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND},
    System::{
      DataExchange::GetClipboardSequenceNumber,
      Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW},
    },
    UI::{
      Input::KeyboardAndMouse::{
        GetAsyncKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VIRTUAL_KEY, VK_C,
        VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_V,
      },
      WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, SetForegroundWindow},
    },
  };

  pub type Window = isize;
  pub const KEY_C: VIRTUAL_KEY = VK_C;
  pub const KEY_V: VIRTUAL_KEY = VK_V;

  pub fn target() -> Target {
    let window = unsafe { GetForegroundWindow() };
    Target { window: window as isize, app: process_name(window), title: window_title(window) }
  }

  pub fn focus(target: &Target) {
    unsafe { SetForegroundWindow(target.window as HWND) };
  }

  pub fn clipboard_text() -> String {
    super::arboard_text()
  }

  pub fn change_count() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
  }

  /// Browsers put a `SourceURL:` line in the header of the clipboard's HTML.
  pub fn source_url() -> String {
    let Some(format) = clipboard_win::register_format("HTML Format") else { return String::new() };
    let Ok(_open) = clipboard_win::Clipboard::new_attempts(10) else { return String::new() };
    let mut html = Vec::new();
    if clipboard_win::raw::get_vec(format.get(), &mut html).is_err() {
      return String::new();
    }
    let html = String::from_utf8_lossy(&html);
    let header = html.lines().take_while(|line| !line.starts_with('<'));
    let url = header.filter_map(|line| line.strip_prefix("SourceURL:")).map(str::trim).next().unwrap_or_default();
    // Electron apps like Mailspring name their own files here, which says nothing about the text.
    if url.starts_with("http://") || url.starts_with("https://") { url.to_string() } else { String::new() }
  }

  /// A shortcut sent while the hotkey's Alt is still held arrives as Ctrl+Alt+C.
  pub fn wait_for_modifiers_released() {
    let modifiers = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN];
    for _ in 0..100 {
      if modifiers.iter().all(|&key| unsafe { GetAsyncKeyState(key as i32) } >= 0) {
        return;
      }
      sleep(Duration::from_millis(10));
    }
  }

  /// Ctrl plus `letter`.
  pub fn send_shortcut(letter: VIRTUAL_KEY) {
    let inputs = [key(VK_CONTROL, false), key(letter, false), key(letter, true), key(VK_CONTROL, true)];
    unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
  }

  fn key(key: VIRTUAL_KEY, up: bool) -> INPUT {
    let flags = if up { KEYEVENTF_KEYUP } else { 0 };
    let ki = KEYBDINPUT { wVk: key, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 };
    INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki } }
  }

  fn window_title(window: HWND) -> String {
    let mut buffer = [0u16; 512];
    let length = unsafe { GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
  }

  /// The executable's name without extension, like "chrome" or "Code".
  fn process_name(window: HWND) -> String {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
      return String::new();
    }
    let mut buffer = [0u16; 1024];
    let mut length = buffer.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut length) };
    unsafe { CloseHandle(process) };
    if ok == 0 {
      return String::new();
    }
    let path = String::from_utf16_lossy(&buffer[..length as usize]);
    std::path::Path::new(&path).file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default()
  }
}

/// Sending keys needs the Accessibility permission, which macOS asks the user for once.
#[cfg(target_os = "macos")]
mod platform {
  use super::Target;
  use objc2_app_kit::{NSApplicationActivationOptions, NSPasteboard, NSRunningApplication, NSWorkspace};
  use objc2_core_graphics::{CGEvent, CGEventFlags, CGEventSource, CGEventSourceStateID, CGEventTapLocation};
  use std::{thread::sleep, time::Duration};

  /// The app's process id; the window title needs the Accessibility API, which pluck doesn't ask yet.
  pub type Window = i32;
  /// Virtual key codes of C and V on an ANSI layout.
  pub const KEY_C: u16 = 8;
  pub const KEY_V: u16 = 9;

  pub fn target() -> Target {
    let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() else { return Target::default() };
    let name = app.localizedName().map(|name| name.to_string()).unwrap_or_default();
    Target { window: app.processIdentifier(), app: name, title: String::new() }
  }

  pub fn focus(target: &Target) {
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(target.window) {
      app.activateWithOptions(NSApplicationActivationOptions::empty());
    }
  }

  pub fn clipboard_text() -> String {
    super::arboard_text()
  }

  pub fn change_count() -> isize {
    NSPasteboard::generalPasteboard().changeCount()
  }

  pub fn source_url() -> String {
    String::new()
  }

  pub fn wait_for_modifiers_released() {
    let held = CGEventFlags::MaskCommand | CGEventFlags::MaskAlternate | CGEventFlags::MaskShift | CGEventFlags::MaskControl;
    for _ in 0..100 {
      if !CGEventSource::flags_state(CGEventSourceStateID::HIDSystemState).intersects(held) {
        return;
      }
      sleep(Duration::from_millis(10));
    }
  }

  /// Cmd plus `letter`.
  pub fn send_shortcut(letter: u16) {
    for down in [true, false] {
      if let Some(event) = CGEvent::new_keyboard_event(None, letter, down) {
        CGEvent::set_flags(Some(&event), CGEventFlags::MaskCommand);
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&event));
      }
    }
  }
}

/// Hyprland on Wayland: `hyprctl` names the window, `wl-clipboard` and `wtype` read and type.
#[cfg(target_os = "linux")]
mod platform {
  use super::{Selection, Target};
  use std::{
    io::Write,
    process::{Command, Stdio},
    thread::sleep,
    time::Duration,
  };

  /// Hyprland's window address.
  pub type Window = String;

  pub fn target() -> Target {
    let window = output("hyprctl", &["activewindow", "-j"])
      .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
      .unwrap_or_default();
    let field = |name: &str| window[name].as_str().unwrap_or_default().to_string();
    Target { window: field("address"), app: field("class"), title: field("title") }
  }

  pub fn focus(target: &Target) {
    if !target.window.is_empty() {
      let _ = output("hyprctl", &["dispatch", "focuswindow", &format!("address:{}", target.window)]);
    }
  }

  pub fn clipboard_text() -> String {
    output("wl-paste", &["--no-newline", "--type", "text"]).unwrap_or_default()
  }

  /// The primary selection holds what was last highlighted, so the clipboard is never touched.
  pub fn copy_selection() -> Result<Selection, String> {
    let text = output("wl-paste", &["--primary", "--no-newline", "--type", "text"]).unwrap_or_default();
    Ok(Selection { text, url: String::new() })
  }

  /// Pastes through the clipboard with `wtype`, then gives the clipboard back.
  pub fn paste(target: &Target, text: &str) -> Result<(), String> {
    let previous = clipboard_text();
    set_clipboard(text)?;
    focus(target);
    let typed = output("wtype", &["-M", "ctrl", "v", "-m", "ctrl"]);
    sleep(Duration::from_millis(300));
    set_clipboard(&previous)?;
    typed.map(|_| ()).ok_or_else(|| "Replacing needs wtype installed".to_string())
  }

  pub fn set_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new("wl-copy")
      .stdin(Stdio::piped())
      .spawn()
      .map_err(|error| format!("Couldn't run wl-copy: {error}"))?;
    child.stdin.take().expect("stdin is piped").write_all(text.as_bytes()).map_err(|error| error.to_string())?;
    child.wait().map_err(|error| error.to_string())?;
    Ok(())
  }

  /// The command's stdout, or None when it can't run or fails.
  fn output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
  }
}
