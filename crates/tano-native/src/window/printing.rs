use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrintSettings {
    pub paper: String,
    pub landscape: bool,
    pub copies: u32,
    pub page_ranges: String,
    pub color: bool,
    pub duplex: String,
    pub margins: f64,
    pub scale: f64,
    pub backgrounds: bool,
    pub headers: bool,
    pub printer: String,
}

impl PrintSettings {
    fn validate(&self) -> Result<(), String> {
        if !["a4", "a3", "a5", "letter", "legal"].contains(&self.paper.as_str())
            || !(1..=999).contains(&self.copies)
            || !self.margins.is_finite()
            || !(0.0..=40.0).contains(&self.margins)
            || !self.scale.is_finite()
            || !(0.1..=2.0).contains(&self.scale)
            || !["simplex", "long", "short"].contains(&self.duplex.as_str())
            || self.printer.contains('\0')
            || self.printer.len() > 4096
        {
            return Err("打印设置无效".into());
        }
        if !self.page_ranges.is_empty() {
            for part in self.page_ranges.split(',') {
                let bounds: Vec<_> = part.trim().split('-').collect();
                let number = |value: &str| {
                    value
                        .trim()
                        .parse::<u32>()
                        .ok()
                        .filter(|value| *value > 0 && *value <= 100000)
                };
                if bounds.is_empty()
                    || bounds.len() > 2
                    || number(bounds[0]).is_none()
                    || (bounds.len() == 2
                        && (number(bounds[1]).is_none() || number(bounds[0]) > number(bounds[1])))
                {
                    return Err("页码范围无效，请填写如 1-5,8,11-13".into());
                }
            }
        }
        Ok(())
    }
    fn size(&self) -> (f64, f64) {
        match self.paper.as_str() {
            "a3" => (297.0, 420.0),
            "a5" => (148.0, 210.0),
            "letter" => (215.9, 279.4),
            "legal" => (215.9, 355.6),
            _ => (210.0, 297.0),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Printers {
    native_settings: bool,
    default_printer: String,
    printers: Vec<String>,
}

fn ensure_print_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label().starts_with("print-") {
        Ok(())
    } else {
        Err("只能在打印窗口中执行此操作".into())
    }
}

#[tauri::command]
pub async fn document_print_printers(window: tauri::WebviewWindow) -> Result<Printers, String> {
    ensure_print_window(&window)?;
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(windows_print::printers)
        .await
        .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    Ok(Printers {
        native_settings: false,
        default_printer: String::new(),
        printers: vec![],
    })
}

#[tauri::command]
pub async fn document_print_preview(
    window: tauri::WebviewWindow,
    settings: PrintSettings,
) -> Result<String, String> {
    ensure_print_window(&window)?;
    settings.validate()?;
    #[cfg(windows)]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| {
                let result = windows_print::preview(webview, settings, sender);
                if let Err(error) = result {
                    eprintln!("Print preview failed: {error}");
                }
            })
            .map_err(|error| error.to_string())?;
        let bytes = receiver
            .await
            .map_err(|_| "无法生成打印预览".to_string())??;
        return Ok(base64::engine::general_purpose::STANDARD.encode(bytes));
    }
    #[cfg(not(windows))]
    Err("当前平台请使用系统打印".into())
}

#[tauri::command]
pub async fn document_print_submit(
    window: tauri::WebviewWindow,
    settings: PrintSettings,
) -> Result<(), String> {
    ensure_print_window(&window)?;
    settings.validate()?;
    #[cfg(windows)]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| {
                let result = windows_print::submit(webview, settings, sender);
                if let Err(error) = result {
                    eprintln!("Printing failed: {error}");
                }
            })
            .map_err(|error| error.to_string())?;
        return receiver.await.map_err(|_| "打印任务未完成".to_string())?;
    }
    #[cfg(not(windows))]
    Err("当前平台请使用系统打印".into())
}

#[cfg(windows)]
mod windows_print {
    use super::*;
    use std::ptr::{null, null_mut};
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::*, PrintCompletedHandler, PrintToPdfStreamCompletedHandler,
    };
    use windows::{
        core::{Interface, HSTRING},
        Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET},
    };
    use windows_sys::Win32::Graphics::Printing::*;

    unsafe fn wide(pointer: *const u16) -> String {
        if pointer.is_null() {
            return String::new();
        }
        let mut length = 0;
        while length < 32768 && unsafe { *pointer.add(length) } != 0 {
            length += 1;
        }
        String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) })
    }
    pub fn printers() -> Result<Printers, String> {
        unsafe {
            let mut default_size = 0;
            GetDefaultPrinterW(null_mut(), &mut default_size);
            let mut default_name = vec![0u16; default_size as usize];
            let default_printer = if !default_name.is_empty()
                && GetDefaultPrinterW(default_name.as_mut_ptr(), &mut default_size) != 0
            {
                wide(default_name.as_ptr())
            } else {
                String::new()
            };
            let mut needed = 0;
            let mut count = 0;
            let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
            EnumPrintersW(flags, null(), 4, null_mut(), 0, &mut needed, &mut count);
            if needed == 0 {
                return Ok(Printers {
                    native_settings: true,
                    default_printer,
                    printers: vec![],
                });
            }
            let mut buffer = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
            if EnumPrintersW(
                flags,
                null(),
                4,
                buffer.as_mut_ptr().cast(),
                needed,
                &mut needed,
                &mut count,
            ) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let entries = std::slice::from_raw_parts(
                buffer.as_ptr().cast::<PRINTER_INFO_4W>(),
                count as usize,
            );
            let mut printers: Vec<_> = entries
                .iter()
                .map(|entry| wide(entry.pPrinterName))
                .filter(|name| !name.is_empty())
                .collect();
            printers.sort();
            printers.dedup();
            Ok(Printers {
                native_settings: true,
                default_printer,
                printers,
            })
        }
    }
    unsafe fn settings(
        webview: &tauri::webview::PlatformWebview,
        input: &PrintSettings,
        job: bool,
    ) -> windows::core::Result<ICoreWebView2PrintSettings> {
        unsafe {
            let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
            let settings = environment.CreatePrintSettings()?;
            let (width, height) = input.size();
            settings.SetOrientation(if input.landscape {
                COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
            } else {
                COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
            })?;
            settings.SetPageWidth(width / 25.4)?;
            settings.SetPageHeight(height / 25.4)?;
            settings.SetScaleFactor(input.scale)?;
            settings.SetMarginTop(input.margins / 25.4)?;
            settings.SetMarginBottom(input.margins / 25.4)?;
            settings.SetMarginLeft(input.margins / 25.4)?;
            settings.SetMarginRight(input.margins / 25.4)?;
            settings.SetShouldPrintBackgrounds(input.backgrounds)?;
            settings.SetShouldPrintHeaderAndFooter(input.headers)?;
            let extended: ICoreWebView2PrintSettings2 = settings.cast()?;
            extended.SetPageRanges(&HSTRING::from(&input.page_ranges))?;
            extended.SetColorMode(if input.color {
                COREWEBVIEW2_PRINT_COLOR_MODE_COLOR
            } else {
                COREWEBVIEW2_PRINT_COLOR_MODE_GRAYSCALE
            })?;
            if job {
                extended.SetPrinterName(&HSTRING::from(&input.printer))?;
                extended.SetCopies(input.copies as i32)?;
                extended.SetDuplex(match input.duplex.as_str() {
                    "long" => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_LONG_EDGE,
                    "short" => COREWEBVIEW2_PRINT_DUPLEX_TWO_SIDED_SHORT_EDGE,
                    _ => COREWEBVIEW2_PRINT_DUPLEX_ONE_SIDED,
                })?;
            }
            Ok(settings)
        }
    }
    unsafe fn stream_bytes(stream: &IStream) -> Result<Vec<u8>, String> {
        unsafe {
            let mut stat = STATSTG::default();
            stream
                .Stat(&mut stat, STATFLAG_NONAME)
                .map_err(|error| error.to_string())?;
            if stat.cbSize > 64 * 1024 * 1024 {
                return Err("打印预览过大，请减少单次打印页数".into());
            }
            stream
                .Seek(0, STREAM_SEEK_SET, None)
                .map_err(|error| error.to_string())?;
            let mut bytes = vec![0u8; stat.cbSize as usize];
            let mut offset = 0;
            while offset < bytes.len() {
                let mut read = 0;
                stream
                    .Read(
                        bytes.as_mut_ptr().add(offset).cast(),
                        (bytes.len() - offset) as u32,
                        Some(&mut read),
                    )
                    .ok()
                    .map_err(|error| error.to_string())?;
                if read == 0 {
                    return Err("打印预览数据不完整".into());
                }
                offset += read as usize;
            }
            Ok(bytes)
        }
    }
    pub fn preview(
        webview: tauri::webview::PlatformWebview,
        input: PrintSettings,
        sender: tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>,
    ) -> windows::core::Result<()> {
        unsafe {
            let settings = settings(&webview, &input, false)?;
            let view: ICoreWebView2_16 = webview.controller().CoreWebView2()?.cast()?;
            let callback =
                PrintToPdfStreamCompletedHandler::create(Box::new(move |result, stream| {
                    let output = result
                        .map_err(|error| error.to_string())
                        .and_then(|_| stream.ok_or_else(|| "无法生成打印预览".to_string()))
                        .and_then(|stream| stream_bytes(&stream));
                    let _ = sender.send(output);
                    Ok(())
                }));
            view.PrintToPdfStream(&settings, &callback)
        }
    }
    pub fn submit(
        webview: tauri::webview::PlatformWebview,
        input: PrintSettings,
        sender: tokio::sync::oneshot::Sender<Result<(), String>>,
    ) -> windows::core::Result<()> {
        unsafe {
            let settings = settings(&webview, &input, true)?;
            let view: ICoreWebView2_16 = webview.controller().CoreWebView2()?.cast()?;
            let callback = PrintCompletedHandler::create(Box::new(move |result, status| {
                let output = result.map_err(|error| error.to_string()).and_then(|_| {
                    if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED {
                        Ok(())
                    } else if status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE {
                        Err("所选打印机不可用，请检查连接或选择其他打印机".into())
                    } else {
                        Err("打印失败，请检查打印机和打印设置".into())
                    }
                });
                let _ = sender.send(output);
                Ok(())
            }));
            view.Print(&settings, &callback)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> PrintSettings {
        PrintSettings {
            paper: "a4".into(),
            landscape: false,
            copies: 1,
            page_ranges: "1-5,8,11-13".into(),
            color: true,
            duplex: "simplex".into(),
            margins: 16.0,
            scale: 1.0,
            backgrounds: true,
            headers: false,
            printer: "Printer".into(),
        }
    }
    #[test]
    fn validates_settings_before_contacting_any_printer() {
        let mut value = input();
        assert!(value.validate().is_ok());
        for range in ["0", "5-2", "1-", "1,,2", "1-2-3", "a"] {
            value.page_ranges = range.into();
            assert!(value.validate().is_err());
        }
        value = input();
        value.copies = 0;
        assert!(value.validate().is_err());
        value = input();
        value.scale = f64::NAN;
        assert!(value.validate().is_err());
        assert_eq!(input().size(), (210.0, 297.0));
    }
}
