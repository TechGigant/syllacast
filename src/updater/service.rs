// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::error;

use super::client::UpdateClient;
use super::installer::UpdateInstaller;
use super::models::{ReleaseManifest, UpdateNotificationDto, UpdatePhase, UpdateStatusResponse};
use crate::settings::KioskSettings;
use crate::sync::protocol::ServerMessage;

pub struct UpdateService {
    client: UpdateClient,
    installer: UpdateInstaller,
    status: Arc<RwLock<UpdateStatusResponse>>,
    current_manifest: Arc<RwLock<Option<ReleaseManifest>>>,
}

impl UpdateService {
    pub fn new() -> Self {
        let initial_status = UpdateStatusResponse {
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            latest_version: None,
            status: UpdatePhase::Idle,
            progress_percent: None,
            last_checked_at: None,
            error_message: None,
            update_available: None,
            snoozed_until: None,
        };

        Self {
            client: UpdateClient::new(),
            installer: UpdateInstaller::new(),
            status: Arc::new(RwLock::new(initial_status)),
            current_manifest: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn get_status(&self) -> UpdateStatusResponse {
        self.status.read().await.clone()
    }

    /// Performs an immediate check for updates.
    pub async fn check_for_updates(
        &self,
        current_settings: &KioskSettings,
        tx: Option<&broadcast::Sender<ServerMessage>>,
    ) -> Result<Option<ReleaseManifest>, String> {
        {
            let mut st = self.status.write().await;
            st.status = UpdatePhase::Checking;
            st.error_message = None;
        }

        let current_version = env!("CARGO_PKG_VERSION");
        let now_str = chrono::Utc::now().to_rfc3339();

        match self.client.check_for_update(current_version).await {
            Ok(Some(manifest)) => {
                let is_critical = manifest.is_critical_security_update;
                let dto = UpdateNotificationDto {
                    current_version: current_version.to_string(),
                    latest_version: manifest.version.clone(),
                    is_critical_security_update: is_critical,
                    release_notes_url: manifest.html_url.clone(),
                    release_notes: manifest.release_notes.clone(),
                    published_at: manifest.published_at.clone(),
                    download_url: manifest
                        .targets
                        .values()
                        .next()
                        .map(|t| t.download_url.clone()),
                };

                {
                    let mut st = self.status.write().await;
                    st.status = UpdatePhase::Available;
                    st.latest_version = Some(manifest.version.clone());
                    st.last_checked_at = Some(now_str);
                    st.update_available = Some(dto.clone());
                    st.snoozed_until = current_settings.snoozed_update_until;
                }

                *self.current_manifest.write().await = Some(manifest.clone());

                // Check if snoozed (critical updates bypass snooze)
                let now_ms = chrono::Utc::now().timestamp_millis();
                let is_snoozed = !is_critical
                    && current_settings
                        .snoozed_update_until
                        .map(|s| s > now_ms)
                        .unwrap_or(false);

                if !is_snoozed {
                    if let Some(sender) = tx {
                        let _ = sender.send(ServerMessage::UpdateAvailable(dto));
                    }
                }

                Ok(Some(manifest))
            }
            Ok(None) => {
                let mut st = self.status.write().await;
                st.status = UpdatePhase::UpToDate;
                st.latest_version = Some(current_version.to_string());
                st.last_checked_at = Some(now_str);
                st.update_available = None;
                *self.current_manifest.write().await = None;
                Ok(None)
            }
            Err(e) => {
                let mut st = self.status.write().await;
                st.status = UpdatePhase::Error;
                st.error_message = Some(e.clone());
                st.last_checked_at = Some(now_str);
                Err(e)
            }
        }
    }

    /// Triggers downloading and installing the currently available release.
    pub async fn apply_update(&self, tx: broadcast::Sender<ServerMessage>) -> Result<(), String> {
        let manifest = self
            .current_manifest
            .read()
            .await
            .clone()
            .ok_or_else(|| "No update currently available to apply.".to_string())?;

        {
            let mut st = self.status.write().await;
            st.status = UpdatePhase::Downloading;
            st.progress_percent = Some(5);
        }

        let tx_clone = tx.clone();
        let status_ref = Arc::clone(&self.status);

        let progress_cb = move |stage: &str, percent: u8, message: &str| {
            let msg = ServerMessage::UpdateProgress {
                stage: stage.to_string(),
                percent,
                message: message.to_string(),
            };
            let _ = tx_clone.send(msg);

            let status_inner = Arc::clone(&status_ref);
            let stage_str = stage.to_string();
            tokio::spawn(async move {
                let mut st = status_inner.write().await;
                st.progress_percent = Some(percent);
                st.status = match stage_str.as_str() {
                    "downloading" => UpdatePhase::Downloading,
                    "verifying" => UpdatePhase::Verifying,
                    "installing" => UpdatePhase::Installing,
                    "restarting" => UpdatePhase::Restarting,
                    _ => UpdatePhase::Downloading,
                };
            });
        };

        match self.installer.install_update(&manifest, progress_cb).await {
            Ok(_path) => {
                {
                    let mut st = self.status.write().await;
                    st.status = UpdatePhase::Restarting;
                    st.progress_percent = Some(100);
                }

                let _ = tx.send(ServerMessage::UpdateProgress {
                    stage: "restarting".to_string(),
                    percent: 100,
                    message: "Update applied successfully. Restarting service...".to_string(),
                });

                UpdateInstaller::trigger_service_restart();
                Ok(())
            }
            Err(e) => {
                error!("Update installation failed: {}", e);
                let mut st = self.status.write().await;
                st.status = UpdatePhase::Error;
                st.error_message = Some(e.clone());
                let _ = tx.send(ServerMessage::UpdateProgress {
                    stage: "error".to_string(),
                    percent: 0,
                    message: format!("Update failed: {}", e),
                });
                Err(e)
            }
        }
    }

    /// Sets a 24-hour snooze for non-critical update notifications.
    pub async fn snooze_24h(&self) -> i64 {
        let until = chrono::Utc::now().timestamp_millis() + (24 * 3600 * 1000);
        let mut st = self.status.write().await;
        st.snoozed_until = Some(until);
        until
    }
}
