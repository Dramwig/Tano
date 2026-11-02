//! A click-through, non-activating OS surface for the portion of a tab drag
//! outside its WebView. All HWND/GDI resources belong to the polling thread.
use base64::Engine;
use std::ptr::{null, null_mut};
use windows_sys::Win32::{
    Foundation::{HWND, POINT, RECT, SIZE},
    Graphics::Gdi::*,
    UI::WindowsAndMessaging::*,
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bitmap {
    width: i32,
    height: i32,
    rgba: String,
    grab_x: i32,
    grab_y: i32,
}

pub struct Preview {
    hwnd: HWND,
    dc: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
    size: SIZE,
    grab: POINT,
}

impl Preview {
    pub fn new(data: Bitmap) -> Result<Self, String> {
        if !(1..=2048).contains(&data.width) || !(1..=512).contains(&data.height) {
            return Err("Invalid tab preview size".into());
        }
        let pixels = base64::engine::general_purpose::STANDARD
            .decode(data.rgba)
            .map_err(|e| e.to_string())?;
        if pixels.len() != data.width as usize * data.height as usize * 4 {
            return Err("Invalid tab preview pixels".into());
        }
        unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                windows_sys::w!("STATIC"),
                windows_sys::w!("Tano tab preview"),
                WS_POPUP,
                0,
                0,
                data.width,
                data.height,
                null_mut(),
                null_mut(),
                null_mut(),
                null(),
            );
            if hwnd.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let mut preview = Self {
                hwnd,
                dc: CreateCompatibleDC(null_mut()),
                bitmap: null_mut(),
                old: null_mut(),
                size: SIZE {
                    cx: data.width,
                    cy: data.height,
                },
                grab: POINT {
                    x: data.grab_x,
                    y: data.grab_y,
                },
            };
            if preview.dc.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = data.width;
            info.bmiHeader.biHeight = -data.height;
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            let mut bits = null_mut();
            preview.bitmap =
                CreateDIBSection(preview.dc, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
            if preview.bitmap.is_null() || bits.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let output = std::slice::from_raw_parts_mut(bits as *mut u8, pixels.len());
            for (source, target) in pixels.chunks_exact(4).zip(output.chunks_exact_mut(4)) {
                let alpha = source[3] as u16;
                target[0] = (source[2] as u16 * alpha / 255) as u8;
                target[1] = (source[1] as u16 * alpha / 255) as u8;
                target[2] = (source[0] as u16 * alpha / 255) as u8;
                target[3] = source[3];
            }
            preview.old = SelectObject(preview.dc, preview.bitmap);
            Ok(preview)
        }
    }

    pub fn update(&self, cursor: POINT, source: HWND) -> Result<(), String> {
        unsafe {
            let mut rect: RECT = std::mem::zeroed();
            let inside = GetWindowRect(source, &mut rect) != 0
                && cursor.x >= rect.left
                && cursor.x < rect.right
                && cursor.y >= rect.top
                && cursor.y < rect.bottom;
            if inside {
                ShowWindow(self.hwnd, SW_HIDE);
            } else {
                let position = POINT {
                    x: cursor.x - self.grab.x,
                    y: cursor.y - self.grab.y,
                };
                let origin = POINT { x: 0, y: 0 };
                let blend = BLENDFUNCTION {
                    BlendOp: AC_SRC_OVER as u8,
                    BlendFlags: 0,
                    SourceConstantAlpha: 255,
                    AlphaFormat: AC_SRC_ALPHA as u8,
                };
                if UpdateLayeredWindow(
                    self.hwnd,
                    null_mut(),
                    &position,
                    &self.size,
                    self.dc,
                    &origin,
                    0,
                    &blend,
                    ULW_ALPHA,
                ) == 0
                {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                if SetWindowPos(
                    self.hwnd,
                    HWND_TOPMOST,
                    position.x,
                    position.y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                ) == 0
                {
                    return Err(std::io::Error::last_os_error().to_string());
                }
            }
            let mut message: MSG = std::mem::zeroed();
            while PeekMessageW(&mut message, self.hwnd, 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            Ok(())
        }
    }
}

impl Drop for Preview {
    fn drop(&mut self) {
        unsafe {
            if !self.old.is_null() {
                SelectObject(self.dc, self.old);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.dc.is_null() {
                DeleteDC(self.dc);
            }
            DestroyWindow(self.hwnd);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_preview_tracks_outside_hides_inside_and_releases_window() {
        unsafe {
            let source = CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                windows_sys::w!("STATIC"),
                windows_sys::w!("preview test source"),
                WS_POPUP,
                100,
                100,
                200,
                200,
                null_mut(),
                null_mut(),
                null_mut(),
                null(),
            );
            assert!(!source.is_null());
            let preview = Preview::new(Bitmap {
                width: 120,
                height: 32,
                rgba: base64::engine::general_purpose::STANDARD.encode(vec![255; 120 * 32 * 4]),
                grab_x: 20,
                grab_y: 12,
            })
            .unwrap();
            let hwnd = preview.hwnd;
            preview.update(POINT { x: 400, y: 400 }, source).unwrap();
            assert_ne!(IsWindowVisible(hwnd), 0);
            let mut rect: RECT = std::mem::zeroed();
            assert_ne!(GetWindowRect(hwnd, &mut rect), 0);
            assert_eq!(
                (rect.left, rect.top, rect.right - rect.left),
                (380, 388, 120)
            );
            let styles = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            assert_eq!(
                styles & (WS_EX_TRANSPARENT | WS_EX_NOACTIVATE),
                WS_EX_TRANSPARENT | WS_EX_NOACTIVATE
            );
            preview.update(POINT { x: 150, y: 150 }, source).unwrap();
            assert_eq!(IsWindowVisible(hwnd), 0);
            drop(preview);
            assert_eq!(IsWindow(hwnd), 0);
            DestroyWindow(source);
        }
    }
}
