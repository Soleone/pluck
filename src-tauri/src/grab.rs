//! Reading the selection and context from the app that was active when the hotkey was pressed.

/// The window pluck was triggered from, so focus can go back to it.
#[derive(Default)]
pub struct Target {
  window: isize,
  pub app: String,
  pub title: String,
}

/// Clipboard text, used when nothing is selected. Empty when it holds no text.
pub fn clipboard_text() -> String {
  arboard::Clipboard::new().and_then(|mut clipboard| clipboard.get_text()).unwrap_or_default()
}

#[cfg(windows)]
pub use windows::{copy_selection, focus, target};

#[cfg(not(windows))]
pub fn target() -> Target {
  Target::default()
}

#[cfg(not(windows))]
pub fn copy_selection() -> Result<String, String> {
  Err("Reading the selection isn't supported on this platform yet".into())
}

#[cfg(not(windows))]
pub fn focus(_target: &Target) {}

#[cfg(windows)]
mod windows {
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
        VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
      },
      WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, SetForegroundWindow},
    },
  };

  pub fn target() -> Target {
    let window = unsafe { GetForegroundWindow() };
    Target { window: window as isize, app: process_name(window), title: window_title(window) }
  }

  pub fn focus(target: &Target) {
    unsafe { SetForegroundWindow(target.window as HWND) };
  }

  /// Copies the selection with Ctrl+C and puts the previous clipboard text back. An unchanged
  /// clipboard means nothing was selected. Only text survives the round trip.
  pub fn copy_selection() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    let previous = clipboard.get_text().ok();
    let before = unsafe { GetClipboardSequenceNumber() };

    wait_for_modifiers_released();
    send_ctrl_c();
    let copied = (0..50).any(|_| {
      sleep(Duration::from_millis(10));
      before != unsafe { GetClipboardSequenceNumber() }
    });
    if !copied {
      return Ok(String::new());
    }

    let text = clipboard.get_text().unwrap_or_default();
    let restored = match previous {
      Some(previous) => clipboard.set_text(previous),
      None => clipboard.clear(),
    };
    restored.map_err(|error| format!("Couldn't restore the clipboard: {error}"))?;
    Ok(text)
  }

  /// Ctrl+C sent while the hotkey's Alt is still held arrives as Ctrl+Alt+C.
  fn wait_for_modifiers_released() {
    let modifiers = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN];
    for _ in 0..100 {
      if modifiers.iter().all(|&key| unsafe { GetAsyncKeyState(key as i32) } >= 0) {
        return;
      }
      sleep(Duration::from_millis(10));
    }
  }

  fn send_ctrl_c() {
    let inputs = [key(VK_CONTROL, false), key(VK_C, false), key(VK_C, true), key(VK_CONTROL, true)];
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
