// Syllacast - Standalone Spotify Lyrics Kiosk
// Build & Packaging Task Runner (xtask)
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use clap::{Parser, Subcommand};
use flate2::write::GzEncoder;
use flate2::Compression;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const STANDARD_TARGETS: &[&str] = &[
    "x86_64-unknown-linux-musl",
    "aarch64-unknown-linux-musl",
    "armv7-unknown-linux-musleabihf",
];

#[derive(Parser)]
#[command(
    name = "xtask",
    about = "Syllacast build, cross-compilation, and release packager"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Build and package release archives (.tar.gz + SHA256SUMS.txt)
    Dist {
        /// Target triple to build (e.g. aarch64-unknown-linux-musl)
        #[arg(long)]
        target: Option<String>,

        /// Build all three standard static Linux musl targets
        #[arg(long)]
        all: bool,

        /// Skip running 'npm run build' for frontend assets
        #[arg(long)]
        no_frontend_build: bool,
    },

    /// Compile frontend web assets in frontend/
    BuildFrontend,

    /// Validate that an ELF binary is statically linked (no PT_INTERP)
    ValidateStatic {
        /// Path to the binary file
        path: PathBuf,
    },
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let project_root = find_project_root()?;

    match cli.command {
        Commands::BuildFrontend => {
            build_frontend(&project_root)?;
        }

        Commands::ValidateStatic { path } => {
            validate_static_linking(&path)?;
            println!("✓ Static linking verified for {:?}", path);
        }

        Commands::Dist {
            target,
            all,
            no_frontend_build,
        } => {
            if !no_frontend_build {
                let dist_index = project_root
                    .join("frontend")
                    .join("dist")
                    .join("index.html");
                if !dist_index.exists() {
                    println!("frontend/dist/index.html not found; building frontend first...");
                    build_frontend(&project_root)?;
                } else {
                    println!("Found existing frontend/dist/index.html; building frontend to ensure fresh assets...");
                    build_frontend(&project_root)?;
                }
            }

            check_cross_installed()?;

            let targets_to_build: Vec<String> = if all {
                STANDARD_TARGETS.iter().map(|s| s.to_string()).collect()
            } else if let Some(t) = target {
                vec![t]
            } else {
                return Err("Please specify a target with --target <triple> or use --all".into());
            };

            let version = read_package_version(&project_root)?;
            let out_dist_dir = project_root.join("dist");
            fs::create_dir_all(&out_dist_dir)?;

            for tgt in &targets_to_build {
                println!("\n========================================================");
                println!(" Building for target: {}", tgt);
                println!("========================================================");

                build_with_cross(&project_root, tgt)?;

                let binary_path = project_root
                    .join("target")
                    .join(tgt)
                    .join("release")
                    .join("syllacast");

                if !binary_path.exists() {
                    return Err(format!("Expected binary does not exist: {:?}", binary_path).into());
                }

                // Validate static linking for Linux musl targets
                if tgt.contains("musl") {
                    println!("Validating static linking for {}...", tgt);
                    validate_static_linking(&binary_path)?;
                    println!(
                        "✓ {} is confirmed statically linked (no dynamic interpreter)",
                        tgt
                    );
                }

                // Package into .tar.gz archive
                let archive_name = format!("syllacast-v{}-{}.tar.gz", version, tgt);
                let archive_path = out_dist_dir.join(&archive_name);
                package_tarball(&project_root, &binary_path, &archive_path)?;

                // Compute SHA256 checksum
                let sha256 = compute_sha256(&archive_path)?;
                println!("✓ Packaged: {} (SHA256: {})", archive_name, sha256);

                update_sha256sums(&out_dist_dir, &archive_name, &sha256)?;
            }

            println!(
                "\nAll targets packaged successfully into {:?}!",
                out_dist_dir
            );
        }
    }

    Ok(())
}

fn find_project_root() -> Result<PathBuf, String> {
    let mut current = std::env::current_dir().map_err(|e| e.to_string())?;
    loop {
        if current.join("Cargo.toml").exists() && current.join("frontend").exists() {
            return Ok(current);
        }
        if !current.pop() {
            break;
        }
    }
    Err(
        "Could not locate Syllacast project root (must contain Cargo.toml and frontend/)"
            .to_string(),
    )
}

fn read_package_version(project_root: &Path) -> Result<String, String> {
    let cargo_toml = project_root.join("Cargo.toml");
    let content = fs::read_to_string(&cargo_toml).map_err(|e| e.to_string())?;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("version =") {
            let parts: Vec<&str> = trimmed.split('=').collect();
            if parts.len() == 2 {
                return Ok(parts[1].trim().trim_matches('"').to_string());
            }
        }
    }
    Ok("1.0.0".to_string())
}

fn check_cross_installed() -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = Command::new("cmd");
    #[cfg(windows)]
    cmd.args(["/C", "cross --version"]);

    #[cfg(not(windows))]
    let mut cmd = Command::new("cross");
    #[cfg(not(windows))]
    cmd.arg("--version");

    match cmd.output() {
        Ok(out) if out.status.success() => Ok(()),
        _ => Err("Error: 'cross' CLI was not found in PATH.\n\n\
             Please install cross before building:\n\
               cargo install cross --git https://github.com/cross-rs/cross\n\n\
             Or download prebuilt binaries from:\n\
               https://github.com/cross-rs/cross/releases"
            .to_string()),
    }
}

fn build_frontend(project_root: &Path) -> Result<(), String> {
    let frontend_dir = project_root.join("frontend");
    println!(
        "Building frontend web assets via npm in {:?}...",
        frontend_dir
    );

    #[cfg(windows)]
    let mut cmd = Command::new("cmd");
    #[cfg(windows)]
    cmd.args(["/C", "npm run build"]);

    #[cfg(not(windows))]
    let mut cmd = Command::new("npm");
    #[cfg(not(windows))]
    cmd.arg("run").arg("build");

    cmd.current_dir(&frontend_dir);

    let status = cmd
        .status()
        .map_err(|e| format!("Failed to execute npm: {}", e))?;
    if !status.success() {
        return Err(format!("Frontend build failed with exit status {}", status));
    }

    let index_html = frontend_dir.join("dist").join("index.html");
    if !index_html.exists() {
        return Err(format!("Frontend build did not generate {:?}", index_html));
    }
    println!("Frontend web assets built successfully!");
    Ok(())
}

fn build_with_cross(project_root: &Path, target: &str) -> Result<(), String> {
    println!("Running: cross build --release --target {}", target);

    #[cfg(windows)]
    let mut cmd = Command::new("cmd");
    #[cfg(windows)]
    cmd.args(["/C", &format!("cross build --release --target {}", target)]);

    #[cfg(not(windows))]
    let mut cmd = Command::new("cross");
    #[cfg(not(windows))]
    cmd.args(["build", "--release", "--target", target]);

    cmd.current_dir(project_root);

    let status = cmd
        .status()
        .map_err(|e| format!("Failed to invoke 'cross': {}", e))?;

    if !status.success() {
        return Err(format!(
            "Cross build for target {} failed with status {}",
            target, status
        ));
    }
    Ok(())
}

/// Inspects ELF program headers and verifies that PT_INTERP (0x03) is not present.
pub fn validate_static_linking(binary_path: &Path) -> Result<(), String> {
    let mut file = File::open(binary_path).map_err(|e| e.to_string())?;
    let mut header = [0u8; 64];
    file.read_exact(&mut header).map_err(|e| e.to_string())?;

    // Check ELF magic: 0x7F, 'E', 'L', 'F'
    if header[0..4] != [0x7f, b'E', b'L', b'F'] {
        return Err("Binary does not contain valid ELF magic".to_string());
    }

    let is_64bit = header[4] == 2;
    let is_little_endian = header[5] == 1;

    if !is_little_endian {
        return Err(
            "Big-endian ELF binaries are not currently supported for static validation".to_string(),
        );
    }

    let (ph_off, ph_entsize, ph_num) = if is_64bit {
        let ph_off = u64::from_le_bytes(header[32..40].try_into().unwrap());
        let ph_entsize = u16::from_le_bytes(header[54..56].try_into().unwrap()) as usize;
        let ph_num = u16::from_le_bytes(header[56..58].try_into().unwrap()) as usize;
        (ph_off, ph_entsize, ph_num)
    } else {
        let ph_off = u32::from_le_bytes(header[28..32].try_into().unwrap()) as u64;
        let ph_entsize = u16::from_le_bytes(header[42..44].try_into().unwrap()) as usize;
        let ph_num = u16::from_le_bytes(header[44..46].try_into().unwrap()) as usize;
        (ph_off, ph_entsize, ph_num)
    };

    use std::io::Seek;
    file.seek(std::io::SeekFrom::Start(ph_off))
        .map_err(|e| e.to_string())?;

    let mut entry_buf = vec![0u8; ph_entsize];
    for _ in 0..ph_num {
        file.read_exact(&mut entry_buf).map_err(|e| e.to_string())?;
        let p_type = u32::from_le_bytes(entry_buf[0..4].try_into().unwrap());
        if p_type == 3 {
            // PT_INTERP found
            return Err("Binary contains PT_INTERP program header (it is dynamically linked, not static musl)".to_string());
        }
    }

    Ok(())
}

fn package_tarball(
    project_root: &Path,
    binary_path: &Path,
    archive_path: &Path,
) -> Result<(), String> {
    let tar_gz = File::create(archive_path).map_err(|e| e.to_string())?;
    let enc = GzEncoder::new(tar_gz, Compression::best());
    let mut tar = tar::Builder::new(enc);

    // 1. Add binary as 'syllacast' with 0o755 permissions
    let mut bin_file = File::open(binary_path).map_err(|e| e.to_string())?;
    let metadata = bin_file.metadata().map_err(|e| e.to_string())?;
    let mut header = tar::Header::new_gnu();
    header.set_size(metadata.len());
    header.set_mode(0o755);
    tar.append_data(&mut header, "syllacast", &mut bin_file)
        .map_err(|e| e.to_string())?;

    // 2. Add LICENSE (AGPL-3.0)
    let license_path = project_root.join("LICENSE");
    if license_path.exists() {
        let mut lic_file = File::open(&license_path).map_err(|e| e.to_string())?;
        let meta = lic_file.metadata().map_err(|e| e.to_string())?;
        let mut h = tar::Header::new_gnu();
        h.set_size(meta.len());
        h.set_mode(0o644);
        tar.append_data(&mut h, "LICENSE", &mut lic_file)
            .map_err(|e| e.to_string())?;
    }

    // 3. Add README.md
    let readme_path = project_root.join("README.md");
    if readme_path.exists() {
        let mut readme_file = File::open(&readme_path).map_err(|e| e.to_string())?;
        let meta = readme_file.metadata().map_err(|e| e.to_string())?;
        let mut h = tar::Header::new_gnu();
        h.set_size(meta.len());
        h.set_mode(0o644);
        tar.append_data(&mut h, "README.md", &mut readme_file)
            .map_err(|e| e.to_string())?;
    }

    // 4. Add ATTRIBUTION.md
    let attr_path = project_root.join("ATTRIBUTION.md");
    if attr_path.exists() {
        let mut attr_file = File::open(&attr_path).map_err(|e| e.to_string())?;
        let meta = attr_file.metadata().map_err(|e| e.to_string())?;
        let mut h = tar::Header::new_gnu();
        h.set_size(meta.len());
        h.set_mode(0o644);
        tar.append_data(&mut h, "ATTRIBUTION.md", &mut attr_file)
            .map_err(|e| e.to_string())?;
    }

    tar.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn compute_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let bytes_read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

fn update_sha256sums(dist_dir: &Path, file_name: &str, sha256: &str) -> Result<(), String> {
    let sums_path = dist_dir.join("SHA256SUMS.txt");
    let mut entries: Vec<(String, String)> = Vec::new();

    if sums_path.exists() {
        let content = fs::read_to_string(&sums_path).unwrap_or_default();
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 2 && parts[1] != file_name {
                entries.push((parts[0].to_string(), parts[1].to_string()));
            }
        }
    }

    entries.push((sha256.to_string(), file_name.to_string()));
    entries.sort_by(|a, b| a.1.cmp(&b.1));

    let mut out = String::new();
    for (hash, name) in entries {
        out.push_str(&format!("{}  {}\n", hash, name));
    }

    fs::write(&sums_path, out).map_err(|e| e.to_string())?;
    Ok(())
}
