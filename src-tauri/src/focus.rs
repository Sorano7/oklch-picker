// Bring the CLIP STUDIO PAINT window to the foreground.

#[cfg(target_os = "windows")]
mod imp {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    type HWND = *mut std::ffi::c_void;
    type BOOL = i32;
    type LPARAM = isize;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            lpEnumFunc: extern "system" fn(HWND, LPARAM) -> BOOL,
            lParam: LPARAM,
        ) -> BOOL;
        fn GetWindowTextW(hWnd: HWND, lpString: *mut u16, nMaxCount: i32) -> i32;
        fn IsWindowVisible(hWnd: HWND) -> BOOL;
        fn SetForegroundWindow(hWnd: HWND) -> BOOL;
    }

    extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        unsafe {
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if len > 0 {
                let title = OsString::from_wide(&buf[..len as usize]);
                if title.to_string_lossy().contains("CLIP STUDIO PAINT") {
                    *(lparam as *mut HWND) = hwnd;
                    return 0; // stop enumeration
                }
            }
        }
        1
    }

    pub fn focus_csp() {
        unsafe {
            let mut hwnd: HWND = std::ptr::null_mut();
            EnumWindows(enum_callback, &mut hwnd as *mut HWND as LPARAM);
            if !hwnd.is_null() {
                SetForegroundWindow(hwnd);
            }
        }
    }
}

/// Focus the CLIP STUDIO PAINT window if it is visible.
/// Only works when our app is already in the foreground (Windows restriction),
/// which is exactly the condition under which we want this to fire.
#[tauri::command]
pub fn focus_csp_window() {
    #[cfg(target_os = "windows")]
    imp::focus_csp();
}
