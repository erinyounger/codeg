use sea_orm::DatabaseConnection;
use tauri::State;

use crate::db::service::app_metadata_service;
use crate::db::AppDatabase;
use crate::models::SystemProxySettings;
use crate::network::proxy;

const SYSTEM_PROXY_SETTINGS_KEY: &str = "system_proxy_settings";

fn normalize_proxy_settings(settings: SystemProxySettings) -> Result<SystemProxySettings, String> {
    if !settings.enabled {
        let proxy_url = settings
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        return Ok(SystemProxySettings {
            enabled: false,
            proxy_url,
        });
    }

    let proxy_url = settings
        .proxy_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "proxy url is required when proxy is enabled".to_string())?;

    reqwest::Proxy::all(proxy_url).map_err(|e| format!("invalid proxy url: {e}"))?;

    Ok(SystemProxySettings {
        enabled: true,
        proxy_url: Some(proxy_url.to_string()),
    })
}

pub(crate) async fn load_system_proxy_settings(
    conn: &DatabaseConnection,
) -> Result<SystemProxySettings, String> {
    let raw = app_metadata_service::get_value(conn, SYSTEM_PROXY_SETTINGS_KEY)
        .await
        .map_err(|e| e.to_string())?;

    let Some(raw) = raw else {
        return Ok(SystemProxySettings::default());
    };

    let parsed = serde_json::from_str::<SystemProxySettings>(&raw)
        .map_err(|e| format!("failed to parse stored proxy settings: {e}"))?;
    normalize_proxy_settings(parsed)
}

#[tauri::command]
pub async fn get_system_proxy_settings(
    db: State<'_, AppDatabase>,
) -> Result<SystemProxySettings, String> {
    load_system_proxy_settings(&db.conn).await
}

#[tauri::command]
pub async fn update_system_proxy_settings(
    settings: SystemProxySettings,
    db: State<'_, AppDatabase>,
) -> Result<SystemProxySettings, String> {
    let normalized = normalize_proxy_settings(settings)?;
    let serialized = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;

    app_metadata_service::upsert_value(&db.conn, SYSTEM_PROXY_SETTINGS_KEY, &serialized)
        .await
        .map_err(|e| e.to_string())?;

    proxy::apply_system_proxy_settings(&normalized)?;
    Ok(normalized)
}
