use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SystemProxySettings {
    pub enabled: bool,
    pub proxy_url: Option<String>,
}
