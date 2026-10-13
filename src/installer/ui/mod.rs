// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod theme;

use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Paragraph},
    Frame, Terminal,
};
use std::io::stdout;
use std::path::PathBuf;
use std::time::Duration;

use super::actions::{self, HealthStatus, InstallConfig};
use super::discovery::{self, DiscoveredSoloist, ExistingSyllacast};

#[derive(Debug, Clone, PartialEq)]
pub enum Screen {
    MainMenu,
    WizardStep1Preflight,
    WizardStep2SoloistSelect,
    WizardStep3UserSelect,
    WizardStep4Credentials,
    WizardStep5Installing,
    WizardStep6Finished,
    ServiceStatusLogs,
    Reconfigure,
    UninstallConfirm,
    UpdateSelect,
}

pub struct AppState {
    pub screen: Screen,
    pub menu_index: usize,
    pub update_select_index: usize,
    pub existing: ExistingSyllacast,
    pub detected_procs: Vec<DiscoveredSoloist>,
    pub detected_dirs: Vec<DiscoveredSoloist>,
    pub soloist_select_index: usize,
    pub custom_data_dir: String,
    pub user_mode_index: usize, // 0: current user, 1: dedicated 'syllacast', 2: custom
    pub custom_user: String,
    pub spicy_key: String,
    pub mask_key: bool,
    pub port: String,
    pub bind: String,
    pub creds_field_index: usize, // 0: key, 1: port, 2: bind
    pub install_logs: Vec<String>,
    pub health_status: Option<Result<HealthStatus, String>>,
    pub service_logs: String,
    pub local_ip: String,
    pub uninstall_remove_data: bool,
    pub uninstall_button_selected: bool,
    pub error_msg: Option<String>,
    pub calling_user: String,
}

impl AppState {
    pub fn new() -> Self {
        let existing = discovery::detect_existing_installation();
        let detected_procs = discovery::scan_running_processes();
        let detected_dirs = discovery::scan_common_soloist_directories();
        let local_ip = discovery::detect_local_ip();
        let (calling_user, _) = discovery::detect_calling_user();

        let initial_key = existing.existing_key.clone().unwrap_or_default();
        let initial_port = existing
            .existing_port
            .map(|p| p.to_string())
            .unwrap_or_else(|| "8080".to_string());
        let initial_custom_data_dir = existing
            .existing_data_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        Self {
            screen: Screen::MainMenu,
            menu_index: 0,
            update_select_index: 0,
            existing,
            detected_procs,
            detected_dirs,
            soloist_select_index: 0,
            custom_data_dir: initial_custom_data_dir,
            user_mode_index: 0,
            custom_user: String::new(),
            spicy_key: initial_key,
            mask_key: true,
            port: initial_port,
            bind: "0.0.0.0".to_string(),
            creds_field_index: 0,
            install_logs: Vec::new(),
            health_status: None,
            service_logs: String::new(),
            local_ip,
            uninstall_remove_data: false,
            uninstall_button_selected: false,
            error_msg: None,
            calling_user,
        }
    }

    pub fn selected_data_dir(&self) -> PathBuf {
        let total_procs = self.detected_procs.len();
        let total_dirs = self.detected_dirs.len();

        if self.soloist_select_index < total_procs {
            if let Some(ref d) = self.detected_procs[self.soloist_select_index].data_dir {
                return d.clone();
            }
            // If the selected process didn't yield an explicit data dir, prefer the first detected directory
            if let Some(first_dir) = self.detected_dirs.first().and_then(|d| d.data_dir.as_ref()) {
                return first_dir.clone();
            }
        } else if self.soloist_select_index < total_procs + total_dirs {
            let idx = self.soloist_select_index - total_procs;
            if let Some(ref d) = self.detected_dirs[idx].data_dir {
                return d.clone();
            }
        }

        if !self.custom_data_dir.trim().is_empty() {
            PathBuf::from(self.custom_data_dir.trim())
        } else if let Some(first_dir) = self.detected_dirs.first().and_then(|d| d.data_dir.as_ref())
        {
            first_dir.clone()
        } else if let Some(home) = dirs::home_dir() {
            let candidate = home.join(".local/share/soloist");
            if candidate.exists() {
                candidate
            } else if PathBuf::from("/var/lib/soloist-appliance/soloist-data").exists() {
                PathBuf::from("/var/lib/soloist-appliance/soloist-data")
            } else {
                candidate
            }
        } else {
            PathBuf::from("/var/lib/soloist-data")
        }
    }

    pub fn selected_service_user(&self) -> (String, String) {
        match self.user_mode_index {
            0 => (self.calling_user.clone(), self.calling_user.clone()),
            1 => ("syllacast".to_string(), "syllacast".to_string()),
            _ => {
                let u = if self.custom_user.trim().is_empty() {
                    "syllacast".to_string()
                } else {
                    self.custom_user.trim().to_string()
                };
                (u.clone(), u)
            }
        }
    }
}

pub async fn run_tui() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut state = AppState::new();

    let res = main_loop(&mut terminal, &mut state).await;

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(e) = res {
        eprintln!("Installer error: {}", e);
    }
    Ok(())
}

async fn main_loop(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    state: &mut AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    loop {
        terminal.draw(|f| render_ui(f, state))?;

        if state.screen == Screen::WizardStep5Installing {
            execute_install_step(state).await;
            continue;
        }

        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press && handle_key_event(key.code, state).await {
                    break;
                }
            }
        }
    }
    Ok(())
}

async fn handle_key_event(code: KeyCode, state: &mut AppState) -> bool {
    state.error_msg = None;

    match state.screen {
        Screen::MainMenu => match code {
            KeyCode::Char('q') | KeyCode::Esc => return true,
            KeyCode::Up => {
                if state.menu_index > 0 {
                    state.menu_index -= 1;
                } else {
                    state.menu_index = 5;
                }
            }
            KeyCode::Down => {
                if state.menu_index < 5 {
                    state.menu_index += 1;
                } else {
                    state.menu_index = 0;
                }
            }
            KeyCode::Char('1') => {
                state.menu_index = 0;
                state.screen = Screen::WizardStep1Preflight;
            }
            KeyCode::Char('2') => {
                state.menu_index = 1;
                state.screen = Screen::UpdateSelect;
            }
            KeyCode::Char('3') => {
                state.menu_index = 2;
                state.screen = Screen::Reconfigure;
            }
            KeyCode::Char('4') => {
                state.menu_index = 3;
                state.service_logs = actions::get_service_logs(30);
                state.screen = Screen::ServiceStatusLogs;
            }
            KeyCode::Char('5') => {
                state.menu_index = 4;
                state.screen = Screen::UninstallConfirm;
            }
            KeyCode::Enter => match state.menu_index {
                0 => state.screen = Screen::WizardStep1Preflight,
                1 => state.screen = Screen::UpdateSelect,
                2 => state.screen = Screen::Reconfigure,
                3 => {
                    state.service_logs = actions::get_service_logs(30);
                    state.screen = Screen::ServiceStatusLogs;
                }
                4 => state.screen = Screen::UninstallConfirm,
                5 => return true,
                _ => {}
            },

            _ => {}
        },

        Screen::WizardStep1Preflight => match code {
            KeyCode::Esc => state.screen = Screen::MainMenu,
            KeyCode::Enter => state.screen = Screen::WizardStep2SoloistSelect,
            _ => {}
        },

        Screen::WizardStep2SoloistSelect => {
            let total_options = state.detected_procs.len() + state.detected_dirs.len() + 1;
            match code {
                KeyCode::Esc => state.screen = Screen::WizardStep1Preflight,
                KeyCode::Up => {
                    if state.soloist_select_index > 0 {
                        state.soloist_select_index -= 1;
                    }
                }
                KeyCode::Down => {
                    if state.soloist_select_index + 1 < total_options {
                        state.soloist_select_index += 1;
                    }
                }
                KeyCode::Backspace => {
                    if state.soloist_select_index == total_options - 1 {
                        state.custom_data_dir.pop();
                    }
                }
                KeyCode::Char(c) => {
                    if state.soloist_select_index == total_options - 1 {
                        state.custom_data_dir.push(c);
                    }
                }
                KeyCode::Enter => {
                    state.screen = Screen::WizardStep3UserSelect;
                }
                _ => {}
            }
        }

        Screen::WizardStep3UserSelect => match code {
            KeyCode::Esc => state.screen = Screen::WizardStep2SoloistSelect,
            KeyCode::Up => {
                if state.user_mode_index > 0 {
                    state.user_mode_index -= 1;
                }
            }
            KeyCode::Down => {
                if state.user_mode_index < 2 {
                    state.user_mode_index += 1;
                }
            }
            KeyCode::Backspace => {
                if state.user_mode_index == 2 {
                    state.custom_user.pop();
                }
            }
            KeyCode::Char(c) => {
                if state.user_mode_index == 2 {
                    state.custom_user.push(c);
                }
            }
            KeyCode::Enter => {
                state.screen = Screen::WizardStep4Credentials;
            }
            _ => {}
        },

        Screen::WizardStep4Credentials => {
            match code {
                KeyCode::Esc => state.screen = Screen::WizardStep3UserSelect,
                KeyCode::F(2) => state.mask_key = !state.mask_key,
                KeyCode::Tab | KeyCode::Down => {
                    state.creds_field_index = (state.creds_field_index + 1) % 3;
                }
                KeyCode::Up => {
                    if state.creds_field_index > 0 {
                        state.creds_field_index -= 1;
                    } else {
                        state.creds_field_index = 2;
                    }
                }
                KeyCode::Backspace => match state.creds_field_index {
                    0 => {
                        state.spicy_key.pop();
                    }
                    1 => {
                        state.port.pop();
                    }
                    2 => {
                        state.bind.pop();
                    }
                    _ => {}
                },
                KeyCode::Char(c) => match state.creds_field_index {
                    0 => state.spicy_key.push(c),
                    1 => {
                        if c.is_ascii_digit() {
                            state.port.push(c);
                        }
                    }
                    2 => state.bind.push(c),
                    _ => {}
                },
                KeyCode::Enter => {
                    if state.spicy_key.trim().is_empty() {
                        state.error_msg = Some("Warning: No Spicy Lyrics API key entered. Remote lyrics will be disabled.".to_string());
                    }
                    state.screen = Screen::WizardStep5Installing;
                }
                _ => {}
            }
        }

        Screen::WizardStep5Installing => {}

        Screen::WizardStep6Finished => match code {
            KeyCode::Enter | KeyCode::Esc | KeyCode::Char('q') => {
                state.existing = discovery::detect_existing_installation();
                state.screen = Screen::MainMenu;
            }
            _ => {}
        },

        Screen::ServiceStatusLogs => match code {
            KeyCode::Esc | KeyCode::Char('q') => state.screen = Screen::MainMenu,
            KeyCode::Char('r') => {
                state.service_logs = actions::get_service_logs(40);
                state.existing = discovery::detect_existing_installation();
            }
            _ => {}
        },

        Screen::Reconfigure => match code {
            KeyCode::Esc => state.screen = Screen::MainMenu,
            KeyCode::F(2) => state.mask_key = !state.mask_key,
            KeyCode::Tab | KeyCode::Down => {
                state.creds_field_index = (state.creds_field_index + 1) % 3;
            }
            KeyCode::Up => {
                if state.creds_field_index > 0 {
                    state.creds_field_index -= 1;
                } else {
                    state.creds_field_index = 2;
                }
            }
            KeyCode::Backspace => match state.creds_field_index {
                0 => {
                    state.spicy_key.pop();
                }
                1 => {
                    state.port.pop();
                }
                2 => {
                    state.custom_data_dir.pop();
                }
                _ => {}
            },
            KeyCode::Char(c) => match state.creds_field_index {
                0 => state.spicy_key.push(c),
                1 => {
                    if c.is_ascii_digit() {
                        state.port.push(c);
                    }
                }
                2 => state.custom_data_dir.push(c),
                _ => {}
            },
            KeyCode::Enter => {
                let port: u16 = state.port.trim().parse().unwrap_or(8080);
                let (user, group) = state.selected_service_user();
                let data_dir = if !state.custom_data_dir.trim().is_empty() {
                    PathBuf::from(state.custom_data_dir.trim())
                } else if let Some(ref existing) = state.existing.existing_data_dir {
                    existing.clone()
                } else {
                    state.selected_data_dir()
                };
                let config = InstallConfig {
                    spicy_key: state.spicy_key.trim().to_string(),
                    soloist_data_dir: data_dir,
                    port,
                    bind: "0.0.0.0".to_string(),
                    service_user: user,
                    service_group: group,
                };
                match actions::reconfigure(&config) {
                    Ok(logs) => {
                        state.install_logs = logs;
                        state.existing = discovery::detect_existing_installation();
                        state.screen = Screen::WizardStep6Finished;
                    }
                    Err(e) => {
                        state.error_msg = Some(e);
                    }
                }
            }
            _ => {}
        },

        Screen::UninstallConfirm => match code {
            KeyCode::Esc => state.screen = Screen::MainMenu,
            KeyCode::Tab | KeyCode::Down | KeyCode::Up => {
                state.uninstall_button_selected = !state.uninstall_button_selected;
            }
            KeyCode::Char(' ') => {
                if !state.uninstall_button_selected {
                    state.uninstall_remove_data = !state.uninstall_remove_data;
                }
            }
            KeyCode::Enter => match actions::uninstall(state.uninstall_remove_data) {
                Ok(logs) => {
                    state.install_logs = logs;
                    state.existing = discovery::detect_existing_installation();
                    state.health_status = None;
                    state.screen = Screen::WizardStep6Finished;
                }
                Err(e) => {
                    state.error_msg = Some(e);
                }
            },
            _ => {}
        },

        Screen::UpdateSelect => match code {
            KeyCode::Esc => state.screen = Screen::MainMenu,
            KeyCode::Up | KeyCode::Down | KeyCode::Tab => {
                state.update_select_index = (state.update_select_index + 1) % 2;
            }
            KeyCode::Enter => {
                if state.update_select_index == 0 {
                    // Check & install latest GitHub release
                    match actions::check_and_install_github_release().await {
                        Ok(logs) => {
                            state.install_logs = logs;
                            state.existing = discovery::detect_existing_installation();
                            state.health_status = None;
                            state.screen = Screen::WizardStep6Finished;
                        }
                        Err(e) => {
                            state.error_msg = Some(e);
                        }
                    }
                } else {
                    // Update from current running binary via wizard
                    state.screen = Screen::WizardStep1Preflight;
                }
            }
            _ => {}
        },
    }

    false
}

async fn execute_install_step(state: &mut AppState) {
    let port: u16 = state.port.trim().parse().unwrap_or(8080);
    let (user, group) = state.selected_service_user();
    let data_dir = state.selected_data_dir();

    let config = InstallConfig {
        spicy_key: state.spicy_key.trim().to_string(),
        soloist_data_dir: data_dir,
        port,
        bind: state.bind.trim().to_string(),
        service_user: user,
        service_group: group,
    };

    match actions::install_or_update(&config) {
        Ok(logs) => {
            state.install_logs = logs;
            let health = actions::check_service_health(port, 12).await;
            state.health_status = Some(health);
            state.screen = Screen::WizardStep6Finished;
        }
        Err(e) => {
            state.error_msg = Some(e);
            state.screen = Screen::WizardStep4Credentials;
        }
    }
}

fn render_ui(frame: &mut Frame, state: &AppState) {
    let area = frame.area();

    // Background block
    let root_block = Block::default().style(Style::default().bg(theme::SLATE_BG));
    frame.render_widget(root_block, area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(8), // Banner
            Constraint::Min(12),   // Content
            Constraint::Length(3), // Footer / Navigation
        ])
        .split(area);

    render_header(frame, chunks[0], state);

    match state.screen {
        Screen::MainMenu => render_main_menu(frame, chunks[1], state),
        Screen::WizardStep1Preflight => render_wizard_step1(frame, chunks[1], state),
        Screen::WizardStep2SoloistSelect => render_wizard_step2(frame, chunks[1], state),
        Screen::WizardStep3UserSelect => render_wizard_step3(frame, chunks[1], state),
        Screen::WizardStep4Credentials => render_wizard_step4(frame, chunks[1], state),
        Screen::WizardStep5Installing => render_wizard_step5(frame, chunks[1], state),
        Screen::WizardStep6Finished => render_wizard_step6(frame, chunks[1], state),
        Screen::ServiceStatusLogs => render_status_logs(frame, chunks[1], state),
        Screen::Reconfigure => render_reconfigure(frame, chunks[1], state),
        Screen::UninstallConfirm => render_uninstall(frame, chunks[1], state),
        Screen::UpdateSelect => render_update_select(frame, chunks[1], state),
    }

    render_footer(frame, chunks[2], state);
}

fn render_header(frame: &mut Frame, area: Rect, state: &AppState) {
    let banner_text = theme::ASCII_BANNER;
    let status_badge = if state.existing.is_service_active {
        Span::styled(
            " ● ACTIVE ",
            Style::default()
                .fg(Color::Black)
                .bg(theme::SPOTIFY_GREEN)
                .add_modifier(Modifier::BOLD),
        )
    } else if state.existing.is_installed {
        Span::styled(
            " ■ STOPPED ",
            Style::default()
                .fg(Color::White)
                .bg(theme::STATUS_RED)
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(
            " ▲ NOT INSTALLED ",
            Style::default()
                .fg(Color::Black)
                .bg(theme::STATUS_YELLOW)
                .add_modifier(Modifier::BOLD),
        )
    };

    let title_line = Line::from(vec![
        Span::styled(
            "Syllacast Installer & Appliance Manager ",
            theme::style_header(),
        ),
        status_badge,
    ]);

    let header_lines = vec![
        Line::from(Span::styled(
            banner_text,
            Style::default().fg(theme::SPOTIFY_GREEN),
        )),
        title_line,
    ];

    let p = Paragraph::new(header_lines).alignment(Alignment::Center);
    frame.render_widget(p, area);
}

fn render_main_menu(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Main Menu ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let items = [
        (
            "1",
            "🚀  Install Syllacast (Setup Wizard)",
            "Configure paths, credentials, and setup systemd service",
        ),
        (
            "2",
            "🔄  Update Syllacast Binary",
            "Overwrites /opt/syllacast with current binary and restarts service",
        ),
        (
            "3",
            "⚙️   Reconfigure Settings",
            "Modify Spicy Lyrics API key, port, or Soloist data directory",
        ),
        (
            "4",
            "📊  Service Status & Live Logs",
            "Inspect running service health, journalctl logs, and test /state",
        ),
        (
            "5",
            "🗑️   Uninstall Syllacast",
            "Stop, disable, and cleanly remove systemd daemon and files",
        ),
        ("Q", "👋  Exit Installer", "Return to shell"),
    ];

    let mut lines = Vec::new();
    lines.push(Line::from(""));

    for (i, (key, title, desc)) in items.iter().enumerate() {
        let is_selected = i == state.menu_index;
        let prefix = if is_selected { "  ▶ " } else { "    " };

        let key_span = Span::styled(
            format!("[{}] ", key),
            if is_selected {
                Style::default().fg(Color::Black).bg(theme::SPOTIFY_GREEN)
            } else {
                Style::default().fg(theme::ACCENT_BLUE)
            },
        );
        let title_span = Span::styled(
            *title,
            if is_selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(theme::SPOTIFY_GREEN)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
                    .fg(theme::TEXT_WHITE)
                    .add_modifier(Modifier::BOLD)
            },
        );
        let desc_span = Span::styled(
            format!("  — {}", desc),
            if is_selected {
                Style::default()
                    .fg(Color::Rgb(40, 40, 40))
                    .bg(theme::SPOTIFY_GREEN)
            } else {
                theme::style_muted()
            },
        );

        lines.push(Line::from(vec![
            Span::styled(
                prefix,
                if is_selected {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                },
            ),
            key_span,
            title_span,
            desc_span,
        ]));
        lines.push(Line::from(""));
    }

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_wizard_step1(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Step 1/4: Pre-flight & System Detection ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let is_root = discovery::is_root();
    let root_status = if is_root {
        Span::styled(
            "✓ Root Privileges Granted (UID 0)",
            Style::default()
                .fg(theme::SPOTIFY_GREEN)
                .add_modifier(Modifier::BOLD),
        )
    } else {
        Span::styled(
            "✗ Non-root user! Installation requires 'sudo syllacast setup'",
            Style::default()
                .fg(theme::STATUS_RED)
                .add_modifier(Modifier::BOLD),
        )
    };

    let procs_count = state.detected_procs.len();
    let procs_status = if procs_count > 0 {
        Span::styled(
            format!(
                "✓ Found {} running Spotify Soloist process(es)",
                procs_count
            ),
            Style::default().fg(theme::SPOTIFY_GREEN),
        )
    } else {
        Span::styled(
            "ℹ No active 'soloist' process found (checking standard paths...)",
            Style::default().fg(theme::STATUS_YELLOW),
        )
    };

    let lines = vec![
        Line::from(""),
        Line::from(vec![Span::raw("  • System Privileges:  "), root_status]),
        Line::from(""),
        Line::from(vec![Span::raw("  • Process Scanning:   "), procs_status]),
        Line::from(""),
        Line::from(vec![
            Span::raw("  • Detected LAN IP:    "),
            Span::styled(&state.local_ip, Style::default().fg(theme::ACCENT_BLUE)),
        ]),
        Line::from(""),
        Line::from(
            "  Syllacast connects to your existing Spotify Soloist appliance daemon and serves",
        ),
        Line::from("  synced karaoke lyrics to kiosk browsers over your local network."),
        Line::from(""),
        Line::from(Span::styled(
            "  Press [ENTER] to proceed to Soloist selection, or [ESC] to return.",
            theme::style_muted(),
        )),
    ];

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_wizard_step2(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Step 2/4: Spotify Soloist Data Directory ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut lines = Vec::new();
    lines.push(Line::from(""));
    lines.push(Line::from(
        "  Select how Syllacast will connect to your Spotify Soloist instance:",
    ));
    lines.push(Line::from(""));

    let mut idx = 0;

    for p in &state.detected_procs {
        let is_sel = idx == state.soloist_select_index;
        let prefix = if is_sel { "  ▶ [●] " } else { "    [ ] " };
        let path_str = p
            .data_dir
            .as_ref()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_else(|| "Default dir".to_string());
        let ws_str = if p.has_ws_enabled {
            "✓ WS enabled"
        } else {
            "⚠ No --ws flag detected"
        };

        lines.push(Line::from(vec![
            Span::styled(
                prefix,
                if is_sel {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                },
            ),
            Span::styled(
                format!("Process PID {} ({}): ", p.pid.unwrap_or(0), ws_str),
                if is_sel {
                    theme::style_selected()
                } else {
                    Style::default()
                        .fg(theme::TEXT_WHITE)
                        .add_modifier(Modifier::BOLD)
                },
            ),
            Span::styled(
                path_str,
                if is_sel {
                    theme::style_selected()
                } else {
                    Style::default().fg(theme::ACCENT_BLUE)
                },
            ),
        ]));
        idx += 1;
    }

    for d in &state.detected_dirs {
        let is_sel = idx == state.soloist_select_index;
        let prefix = if is_sel { "  ▶ [●] " } else { "    [ ] " };
        let path_str = d
            .data_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        lines.push(Line::from(vec![
            Span::styled(
                prefix,
                if is_sel {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                },
            ),
            Span::styled(
                "Standard Path: ",
                if is_sel {
                    theme::style_selected()
                } else {
                    Style::default().fg(theme::TEXT_WHITE)
                },
            ),
            Span::styled(
                path_str,
                if is_sel {
                    theme::style_selected()
                } else {
                    Style::default().fg(theme::ACCENT_BLUE)
                },
            ),
        ]));
        idx += 1;
    }

    let is_custom = idx == state.soloist_select_index;
    let custom_prefix = if is_custom {
        "  ▶ [●] "
    } else {
        "    [ ] "
    };
    lines.push(Line::from(vec![
        Span::styled(
            custom_prefix,
            if is_custom {
                Style::default()
                    .fg(theme::SPOTIFY_GREEN)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            },
        ),
        Span::styled(
            "Custom Path: ",
            if is_custom {
                theme::style_selected()
            } else {
                Style::default().fg(theme::TEXT_WHITE)
            },
        ),
        Span::styled(
            if state.custom_data_dir.is_empty() {
                "/path/to/soloist-data"
            } else {
                &state.custom_data_dir
            },
            if is_custom {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                theme::style_muted()
            },
        ),
    ]));

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("  Use [↑/↓] to select. If Custom Path is selected, type to edit. Press [ENTER] to continue.", theme::style_muted())));

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_wizard_step3(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Step 3/4: Service Execution User ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let users = [
        (
            "Current User",
            format!(
                "Run as '{}' (recommended if Soloist runs under this account)",
                state.calling_user
            ),
        ),
        (
            "Dedicated System User",
            "Run under dedicated system user 'syllacast'".to_string(),
        ),
        (
            "Custom User",
            "Specify a custom system username".to_string(),
        ),
    ];

    let mut lines = Vec::new();
    lines.push(Line::from(""));
    lines.push(Line::from(
        "  Select which Linux system user the Syllacast systemd service should run as:",
    ));
    lines.push(Line::from(""));

    for (i, (title, desc)) in users.iter().enumerate() {
        let is_sel = i == state.user_mode_index;
        let prefix = if is_sel { "  ▶ [●] " } else { "    [ ] " };

        lines.push(Line::from(vec![
            Span::styled(
                prefix,
                if is_sel {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                },
            ),
            Span::styled(
                *title,
                if is_sel {
                    theme::style_selected()
                } else {
                    Style::default()
                        .fg(theme::TEXT_WHITE)
                        .add_modifier(Modifier::BOLD)
                },
            ),
            Span::styled(
                format!(" — {}", desc),
                if is_sel {
                    theme::style_selected()
                } else {
                    theme::style_muted()
                },
            ),
        ]));

        if i == 2 && is_sel {
            lines.push(Line::from(vec![
                Span::raw("        Username: "),
                Span::styled(
                    if state.custom_user.is_empty() {
                        "type username..."
                    } else {
                        &state.custom_user
                    },
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ),
            ]));
        }
        lines.push(Line::from(""));
    }

    lines.push(Line::from(Span::styled(
        "  Use [↑/↓] to choose. Press [ENTER] to continue.",
        theme::style_muted(),
    )));

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_wizard_step4(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Step 4/4: Configuration & Credentials ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let display_key = if state.mask_key && !state.spicy_key.is_empty() {
        "●".repeat(state.spicy_key.len().min(32))
    } else if state.spicy_key.is_empty() {
        "(none - press to enter sl_sk_...)".to_string()
    } else {
        state.spicy_key.clone()
    };

    let fields = [
        (
            "Spicy Lyrics API Key (F2 toggles mask)",
            &display_key,
            "Get key from spicylyrics.org",
        ),
        (
            "HTTP Port",
            &state.port,
            "Port to serve web UI and WebSocket on",
        ),
        ("Bind Address", &state.bind, "0.0.0.0 binds all interfaces"),
    ];

    let mut lines = Vec::new();
    lines.push(Line::from(""));

    for (i, (label, val, hint)) in fields.iter().enumerate() {
        let is_active = i == state.creds_field_index;
        let prefix = if is_active { "  ▶ " } else { "    " };

        lines.push(Line::from(vec![
            Span::styled(
                prefix,
                if is_active {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                },
            ),
            Span::styled(
                format!("{}: ", label),
                if is_active {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(theme::TEXT_WHITE)
                },
            ),
            Span::styled(
                *val,
                if is_active {
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Yellow)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(theme::ACCENT_BLUE)
                },
            ),
            Span::styled(format!("  ({})", hint), theme::style_muted()),
        ]));
        lines.push(Line::from(""));
    }

    if let Some(ref err) = state.error_msg {
        lines.push(Line::from(Span::styled(
            format!("  {}", err),
            Style::default()
                .fg(theme::STATUS_RED)
                .add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(""));
    }

    lines.push(Line::from(Span::styled("  Use [TAB/↑/↓] to switch fields. Type to edit. [F2] toggles key visibility. [ENTER] to Install!", theme::style_muted())));

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_wizard_step5(frame: &mut Frame, area: Rect, _state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Installing Syllacast... ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let lines = vec![
        Line::from(""),
        Line::from(Span::styled(
            "  ⏳ Setting up Syllacast service and verifying runtime health...",
            Style::default()
                .fg(theme::SPOTIFY_GREEN)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from("  • Copying standalone binary to /opt/syllacast/syllacast"),
        Line::from("  • Creating /usr/local/bin/syllacast symlink"),
        Line::from("  • Writing protected configuration to /opt/syllacast/.env"),
        Line::from("  • Installing systemd unit: /etc/systemd/system/syllacast.service"),
        Line::from("  • Starting service and polling http://127.0.0.1:<port>/state"),
        Line::from(""),
        Line::from(Span::styled(
            "  Please wait a moment...",
            theme::style_muted(),
        )),
    ];

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_wizard_step6(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Installation Complete & Service Verified ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut lines = Vec::new();
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "  🎉 Syllacast has been successfully installed and started!",
        Style::default()
            .fg(theme::SPOTIFY_GREEN)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(""));

    match &state.health_status {
        Some(Ok(health)) => {
            lines.push(Line::from(vec![
                Span::raw("  • Service Health:    "),
                Span::styled(
                    "✓ HTTP 200 OK — Active & Responsive",
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD),
                ),
            ]));
            lines.push(Line::from(vec![
                Span::raw("  • Playback Status:   "),
                Span::styled(
                    if health.is_playing {
                        "Playing"
                    } else {
                        "Paused / Idle"
                    },
                    Style::default().fg(theme::ACCENT_BLUE),
                ),
            ]));
            if let Some(ref t) = health.track_title {
                let artist = health.track_artist.as_deref().unwrap_or("Unknown Artist");
                lines.push(Line::from(vec![
                    Span::raw("  • Current Track:     "),
                    Span::styled(
                        format!("{} - {}", t, artist),
                        Style::default()
                            .fg(theme::TEXT_WHITE)
                            .add_modifier(Modifier::BOLD),
                    ),
                ]));
            }
        }
        Some(Err(err)) => {
            lines.push(Line::from(vec![
                Span::raw("  • Service Health:    "),
                Span::styled(
                    format!("⚠ {}", err),
                    Style::default().fg(theme::STATUS_YELLOW),
                ),
            ]));
        }
        None => {}
    }

    let port_str = state.port.trim();
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "  Access URLs for Kiosk Displays & Browsers:",
        Style::default()
            .fg(theme::TEXT_WHITE)
            .add_modifier(Modifier::BOLD),
    )));
    lines.push(Line::from(vec![
        Span::raw("  • Fullscreen Kiosk:   "),
        Span::styled(
            format!("http://{}:{}/", state.local_ip, port_str),
            Style::default()
                .fg(theme::ACCENT_BLUE)
                .add_modifier(Modifier::UNDERLINED),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::raw("  • Kiosk Settings:     "),
        Span::styled(
            format!("http://{}:{}/settings.html", state.local_ip, port_str),
            Style::default()
                .fg(theme::ACCENT_BLUE)
                .add_modifier(Modifier::UNDERLINED),
        ),
    ]));
    lines.push(Line::from(vec![
        Span::raw("  • Diagnostics State:  "),
        Span::styled(
            format!("http://{}:{}/state", state.local_ip, port_str),
            Style::default()
                .fg(theme::ACCENT_BLUE)
                .add_modifier(Modifier::UNDERLINED),
        ),
    ]));

    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled(
        "  Press [ENTER] to return to the Main Menu.",
        theme::style_muted(),
    )));

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_status_logs(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Syllacast Service Status & Recent Journal Logs ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let status_str = if state.existing.is_service_active {
        "Active (Running)"
    } else {
        "Inactive / Stopped"
    };
    let status_color = if state.existing.is_service_active {
        theme::SPOTIFY_GREEN
    } else {
        theme::STATUS_RED
    };

    let mut lines = Vec::new();
    lines.push(Line::from(vec![
        Span::raw("  Status: "),
        Span::styled(
            status_str,
            Style::default()
                .fg(status_color)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  | Press [r] to refresh logs  | Press [ESC] to return"),
    ]));
    lines.push(Line::from(
        "  ----------------------------------------------------------------------",
    ));

    for l in state
        .service_logs
        .lines()
        .rev()
        .take(18)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        lines.push(Line::from(Span::styled(
            format!("  {}", l),
            Style::default().fg(theme::TEXT_MUTED),
        )));
    }

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_reconfigure(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Reconfigure Syllacast Settings ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let display_key = if state.mask_key && !state.spicy_key.is_empty() {
        "●".repeat(state.spicy_key.len().min(32))
    } else if state.spicy_key.is_empty() {
        "(empty)".to_string()
    } else {
        state.spicy_key.clone()
    };

    let fields = [
        ("Spicy Lyrics API Key", &display_key),
        ("HTTP Port", &state.port),
        ("Soloist Data Directory", &state.custom_data_dir),
    ];

    let mut lines = Vec::new();
    lines.push(Line::from(""));
    lines.push(Line::from(
        "  Update configuration values written to /opt/syllacast/.env:",
    ));
    lines.push(Line::from(""));

    for (i, (label, val)) in fields.iter().enumerate() {
        let is_active = i == state.creds_field_index;
        let prefix = if is_active { "  ▶ " } else { "    " };

        lines.push(Line::from(vec![
            Span::styled(
                prefix,
                if is_active {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                },
            ),
            Span::styled(
                format!("{}: ", label),
                if is_active {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(theme::TEXT_WHITE)
                },
            ),
            Span::styled(
                *val,
                if is_active {
                    Style::default()
                        .fg(Color::Black)
                        .bg(Color::Yellow)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(theme::ACCENT_BLUE)
                },
            ),
        ]));
        lines.push(Line::from(""));
    }

    if let Some(ref err) = state.error_msg {
        lines.push(Line::from(Span::styled(
            format!("  {}", err),
            Style::default().fg(theme::STATUS_RED),
        )));
        lines.push(Line::from(""));
    }

    lines.push(Line::from(Span::styled("  Use [TAB/↑/↓] to switch fields. Type to edit. [ENTER] to save & restart service. [ESC] to cancel.", theme::style_muted())));

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_uninstall(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::STATUS_RED))
        .title(" [ Uninstall Syllacast ] ")
        .title_style(
            Style::default()
                .fg(theme::STATUS_RED)
                .add_modifier(Modifier::BOLD),
        )
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let check_mark = if state.uninstall_remove_data {
        "[X]"
    } else {
        "[ ]"
    };
    let check_style = if !state.uninstall_button_selected {
        theme::style_selected()
    } else {
        Style::default().fg(theme::TEXT_WHITE)
    };

    let btn_style = if state.uninstall_button_selected {
        Style::default()
            .fg(Color::White)
            .bg(theme::STATUS_RED)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default()
            .fg(theme::STATUS_RED)
            .add_modifier(Modifier::BOLD)
    };

    let lines = vec![
        Line::from(""),
        Line::from(Span::styled("  ⚠ Are you sure you want to uninstall Syllacast?", Style::default().fg(theme::STATUS_RED).add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from("  This will:"),
        Line::from("  • Stop and disable syllacast.service"),
        Line::from("  • Remove /etc/systemd/system/syllacast.service"),
        Line::from("  • Remove /usr/local/bin/syllacast symlink"),
        Line::from(""),
        Line::from(vec![
            Span::raw("  "),
            Span::styled(format!("{} Also delete all configuration and cache files in /opt/syllacast", check_mark), check_style),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::raw("  "),
            Span::styled(" [ CONFIRM UNINSTALL ] ", btn_style),
            Span::raw("    "),
            Span::styled("Press [ESC] to cancel", theme::style_muted()),
        ]),
        Line::from(""),
        Line::from(Span::styled("  Use [TAB/↑/↓] to switch between checkbox and button. Press [SPACE] to toggle. Press [ENTER] to confirm.", theme::style_muted())),
    ];

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}

fn render_footer(frame: &mut Frame, area: Rect, _state: &AppState) {
    let text = Line::from(vec![
        Span::styled(
            format!(" Syllacast v{} ", env!("CARGO_PKG_VERSION")),
            Style::default()
                .fg(theme::SPOTIFY_GREEN)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            " | Use [↑/↓/TAB] to navigate, [ENTER] to select, [ESC/q] to exit/back",
            theme::style_muted(),
        ),
    ]);
    let p = Paragraph::new(text).alignment(Alignment::Center);
    frame.render_widget(p, area);
}

fn render_update_select(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::SPOTIFY_GREEN))
        .title(" [ Update Syllacast ] ")
        .title_style(theme::style_header())
        .style(theme::style_card());

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let current_ver = env!("CARGO_PKG_VERSION");
    let options = [
        (
            "Download & Install Latest GitHub Release",
            "Queries GitHub Releases, downloads matching static musl binary, verifies checksum, and updates /opt/syllacast",
        ),
        (
            "Update from Currently Running Binary",
            "Overwrites /opt/syllacast/syllacast using the binary executable you are currently running",
        ),
    ];

    let mut lines = Vec::new();
    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::raw("  Currently Running Version: "),
        Span::styled(
            format!("v{}", current_ver),
            Style::default()
                .fg(theme::SPOTIFY_GREEN)
                .add_modifier(Modifier::BOLD),
        ),
    ]));
    lines.push(Line::from(""));
    lines.push(Line::from("  Select how you want to update Syllacast:"));
    lines.push(Line::from(""));

    for (i, (title, desc)) in options.iter().enumerate() {
        let is_sel = i == state.update_select_index;
        let prefix = if is_sel { "  ▶ [●] " } else { "    [ ] " };

        lines.push(Line::from(vec![
            Span::styled(
                prefix,
                if is_sel {
                    Style::default()
                        .fg(theme::SPOTIFY_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default()
                },
            ),
            Span::styled(
                *title,
                if is_sel {
                    theme::style_selected()
                } else {
                    Style::default()
                        .fg(theme::TEXT_WHITE)
                        .add_modifier(Modifier::BOLD)
                },
            ),
        ]));
        lines.push(Line::from(vec![
            Span::raw("        "),
            Span::styled(format!("— {}", desc), theme::style_muted()),
        ]));
        lines.push(Line::from(""));
    }

    if let Some(ref err) = state.error_msg {
        lines.push(Line::from(Span::styled(
            format!("  Error: {}", err),
            Style::default()
                .fg(theme::STATUS_RED)
                .add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(""));
    }

    lines.push(Line::from(Span::styled(
        "  Use [↑/↓/TAB] to choose. Press [ENTER] to execute. Press [ESC] to return.",
        theme::style_muted(),
    )));

    let p = Paragraph::new(lines);
    frame.render_widget(p, inner);
}
