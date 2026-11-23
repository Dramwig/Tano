use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

const AUXILIARY_PREFIX: &str = "aux-";

#[derive(Debug, PartialEq)]
enum Kind {
    Tab,
    Settings,
}

fn request(opener: &str, url: &str) -> Option<(String, Kind)> {
    if opener != "main" {
        return None;
    }
    let fragment = url.strip_prefix("about:blank#tano-aux=")?;
    let (id, kind) = fragment.split_once("&kind=")?;
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return None;
    }
    let kind = match kind {
        "tab" => Kind::Tab,
        "settings" => Kind::Settings,
        _ => return None,
    };
    Some((format!("{AUXILIARY_PREFIX}{id}"), kind))
}

pub fn create_main(
    app: &tauri::AppHandle,
    config: &tauri::utils::config::WindowConfig,
) -> tauri::Result<tauri::WebviewWindow> {
    let handle = app.clone();
    WebviewWindowBuilder::from_config(app, config)?
        .on_page_load(|main, payload| {
            if payload.event() != PageLoadEvent::Started {
                return;
            }
            // These popups render from the old main document's Vue tree. On
            // reload, window.close() can leave the native WebView2 host alive.
            for (label, window) in main.webview_windows() {
                if label.starts_with(AUXILIARY_PREFIX) {
                    if let Err(error) = window.destroy() {
                        eprintln!("Unable to destroy auxiliary window {label} on main navigation: {error}");
                    }
                }
            }
        })
        .on_new_window(move |url, features| {
            let Some((label, kind)) = request("main", url.as_str()) else {
                return NewWindowResponse::Deny;
            };
            // WebView2 requires an unnavigated WebView for SetNewWindow.
            // Tauri skips initial navigation only for the exact about:blank URL.
            let blank = WebviewUrl::External("about:blank".parse().expect("valid blank URL"));
            let mut builder = WebviewWindowBuilder::new(&handle, label, blank)
                .window_features(features)
                .visible(false)
                .decorations(false)
                .disable_drag_drop_handler()
                .background_color(tauri::window::Color(247, 247, 242, 255))
                .on_new_window(|_, _| NewWindowResponse::Deny);
            builder = match kind {
                Kind::Tab => builder.min_inner_size(800.0, 580.0),
                Kind::Settings => {
                    let Some(parent) = handle.get_webview_window("main") else {
                        return NewWindowResponse::Deny;
                    };
                    let Ok(owned) = builder.min_inner_size(700.0, 500.0).parent(&parent) else {
                        return NewWindowResponse::Deny;
                    };
                    owned
                }
            };
            match builder.build() {
                Ok(window) => NewWindowResponse::Create { window },
                Err(error) => {
                    eprintln!("Unable to create auxiliary window: {error}");
                    NewWindowResponse::Deny
                }
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_scoped_auxiliary_requests() {
        assert_eq!(
            request("main", "about:blank#tano-aux=a-123&kind=tab"),
            Some(("aux-a-123".into(), Kind::Tab))
        );
        assert_eq!(
            request("main", "about:blank#tano-aux=settings&kind=settings"),
            Some(("aux-settings".into(), Kind::Settings))
        );
        for url in [
            "about:blank",
            "https://example.com/#tano-aux=a&kind=tab",
            "about:blank#tano-aux=&kind=tab",
            "about:blank#tano-aux=../a&kind=tab",
            "about:blank#tano-aux=a&kind=unknown",
            "about:blank#tano-aux=a&kind=tab&extra=1",
            "about:blank#tano-aux=%61&kind=tab",
        ] {
            assert_eq!(request("main", url), None, "{url}");
        }
        assert_eq!(request("aux-a", "about:blank#tano-aux=b&kind=tab"), None);
        assert_eq!(
            request(
                "main",
                &format!("about:blank#tano-aux={}&kind=tab", "a".repeat(65))
            ),
            None
        );
    }
}
