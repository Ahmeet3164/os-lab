//! Control API request/response types and routing helpers.
//!
//! The HTTP surface is deliberately small and JSON-only; `protocol` is kept free of
//! runtime dependencies so it can be unit tested without opening windows.

use serde::{Deserialize, Serialize};

pub const DEFAULT_PORT: u16 = 5077;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Viewport {
    #[default]
    Responsive,
    Mobile,
    Tablet,
    Desktop,
}

impl Viewport {
    pub fn as_str(self) -> &'static str {
        match self {
            Viewport::Responsive => "responsive",
            Viewport::Mobile => "mobile",
            Viewport::Tablet => "tablet",
            Viewport::Desktop => "desktop",
        }
    }

    /// Logical size presets, mirroring common emulation targets.
    pub fn logical_size(self) -> (f64, f64) {
        match self {
            Viewport::Responsive => (1024.0, 720.0),
            Viewport::Mobile => (390.0, 844.0),
            Viewport::Tablet => (820.0, 1180.0),
            Viewport::Desktop => (1440.0, 900.0),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpenWindowRequest {
    pub url: String,
    #[serde(default = "default_profile")]
    pub profile: String,
    pub user_agent: Option<String>,
    #[serde(default)]
    pub viewport: Viewport,
}

fn default_profile() -> String {
    "default".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct NavigateRequest {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EvalRequest {
    pub code: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InjectionRequest {
    pub name: String,
    pub code: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProfileRequest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub ephemeral: bool,
}

/// A parsed control-API route. `parse_route` is the single place that maps
/// `METHOD /path` onto an action, so handlers stay thin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Health,
    Overview,
    Windows,
    WindowAction { id: u64, action: WindowAction },
    WindowDelete { id: u64 },
    Injections,
    InjectionDelete { id: String },
    Events,
    Profiles,
    EngineStop,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowAction {
    Navigate,
    Eval,
    Cookies,
    Storage,
    Reload,
    Back,
    Forward,
}

pub fn parse_route(method: &str, path: &str) -> Route {
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    match (method, segments.as_slice()) {
        ("GET", ["healthz"]) => Route::Health,
        ("GET", ["api", "web", "overview"]) => Route::Overview,
        ("GET", ["api", "web", "windows"]) => Route::Windows,
        ("POST", ["api", "web", "windows"]) => Route::Windows,
        ("DELETE", ["api", "web", "windows", id]) => id
            .parse()
            .map(|id| Route::WindowDelete { id })
            .unwrap_or(Route::Unknown),
        ("POST", ["api", "web", "windows", id, action]) => {
            let Some(id) = id.parse().ok() else {
                return Route::Unknown;
            };
            let action = match *action {
                "navigate" => WindowAction::Navigate,
                "eval" => WindowAction::Eval,
                "cookies" => WindowAction::Cookies,
                "storage" => WindowAction::Storage,
                "reload" => WindowAction::Reload,
                "back" => WindowAction::Back,
                "forward" => WindowAction::Forward,
                _ => return Route::Unknown,
            };
            Route::WindowAction { id, action }
        }
        ("GET", ["api", "web", "injections"]) | ("POST", ["api", "web", "injections"]) => {
            Route::Injections
        }
        ("DELETE", ["api", "web", "injections", id]) => Route::InjectionDelete {
            id: (*id).to_string(),
        },
        ("GET", ["api", "web", "events"]) => Route::Events,
        ("GET", ["api", "web", "profiles"]) | ("POST", ["api", "web", "profiles"]) => {
            Route::Profiles
        }
        ("POST", ["api", "web", "engine", "stop"]) => Route::EngineStop,
        _ => Route::Unknown,
    }
}

/// Normalises a user-supplied address into a loadable URL, mirroring the console's
/// behaviour: bare hosts get `https://`.
pub fn normalize_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("url must not be empty".to_string());
    }
    if trimmed.contains("://") {
        return Ok(trimmed.to_string());
    }
    if trimmed.starts_with("about:") || trimmed.starts_with("data:") || trimmed.starts_with("file:")
    {
        return Ok(trimmed.to_string());
    }
    Ok(format!("https://{trimmed}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_map_to_actions() {
        assert_eq!(parse_route("GET", "/healthz"), Route::Health);
        assert_eq!(parse_route("GET", "/api/web/overview"), Route::Overview);
        assert_eq!(parse_route("POST", "/api/web/windows"), Route::Windows);
        assert_eq!(
            parse_route("DELETE", "/api/web/windows/3"),
            Route::WindowDelete { id: 3 }
        );
        assert_eq!(
            parse_route("POST", "/api/web/windows/3/eval"),
            Route::WindowAction {
                id: 3,
                action: WindowAction::Eval
            }
        );
        assert_eq!(parse_route("GET", "/api/web/events"), Route::Events);
        assert_eq!(parse_route("GET", "/nope"), Route::Unknown);
        assert_eq!(
            parse_route("POST", "/api/web/windows/x/eval"),
            Route::Unknown
        );
    }

    #[test]
    fn normalization_adds_scheme() {
        assert_eq!(normalize_url("example.com").unwrap(), "https://example.com");
        assert_eq!(
            normalize_url("http://example.com").unwrap(),
            "http://example.com"
        );
        assert_eq!(normalize_url("about:blank").unwrap(), "about:blank");
        assert!(normalize_url("   ").is_err());
    }

    #[test]
    fn viewport_presets_have_sizes() {
        assert_eq!(Viewport::Mobile.logical_size(), (390.0, 844.0));
        assert_eq!(Viewport::default(), Viewport::Responsive);
    }

    #[test]
    fn open_request_defaults() {
        let request: OpenWindowRequest = serde_json::from_str(r#"{"url":"example.com"}"#).unwrap();
        assert_eq!(request.profile, "default");
        assert_eq!(request.viewport, Viewport::Responsive);
        assert!(request.user_agent.is_none());
    }
}
