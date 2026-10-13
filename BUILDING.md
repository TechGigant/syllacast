# Building Syllacast

This document provides instructions for compiling and building **Syllacast** from source, covering both the TypeScript/WebGL frontend and the Rust backend, as well as Docker-based and cross-platform compilation targets.

---

## 1. Prerequisites

Before building Syllacast, make sure the following development tools are installed on your host system:

- **Rust toolchain** (1.75 or later; recommended 1.99+ or latest stable):
  Install via [rustup](https://rustup.rs/):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  # Or on Windows, download rustup-init.exe from rustup.rs
  ```
- **Node.js & npm** (Node.js 22.x LTS or later):
  Verify installation:
  ```bash
  node --version
  npm --version
  ```
- **Git** (for cloning submodules or repositories):
  ```bash
  git --version
  ```
- **Docker** *(Optional, recommended for container builds or ARM cross-compilation)*:
  ```bash
  docker --version
  ```

---

## 2. Quick Full Build

To build the entire project (both frontend static assets and backend binary):

### Step 1: Build the Frontend
```bash
cd frontend
npm ci
npm run build
cd ..
```
This compiles the TypeScript code and bundles the WebGL visualizer into `frontend/dist/`.

### Step 2: Build the Rust Backend
```bash
cargo build --release
```
The optimized release binary is placed at:
- **Linux / macOS**: `target/release/syllacast`
- **Windows**: `target/release/syllacast.exe`

When executed, the binary automatically locates the static assets in `./frontend/dist`.

---

## 3. Frontend Development & Building

The frontend is built with **TypeScript**, **Vite**, **Nanostores**, and `@kawarp/core` for WebGL fluid background rendering.

### Install Dependencies
```bash
cd frontend
npm install
```

### Development Server (Hot Module Replacement)
To work on the frontend UI with live reload:
```bash
npm run dev
```
By default, Vite serves the development UI at `http://localhost:5173`.

### Running Unit Tests
Unit tests are written using [Vitest](https://vitest.dev/):
```bash
npm test
```

### Production Build
```bash
npm run build
```
This invokes `tsc` to verify type safety, followed by `vite build`. Static output files will be written to `frontend/dist/`.

---

## 4. Backend Development & Building

The backend is built with **Axum**, **Tokio**, and **Clap**.

### Debug Build
```bash
cargo build
```

### Run Unit Tests
```bash
cargo test
```

### Code Formatting & Static Analysis
```bash
cargo check --all-targets
cargo clippy --all-targets
```

### Production Release Binary
```bash
cargo build --release
```

---

## 5. Docker Container Builds

### Universal Multi-Arch Docker Image
Syllacast includes a multi-stage [`Dockerfile`](Dockerfile) that builds the frontend and Rust binary in isolated build containers and produces a minimal runtime image (~50 MB):

```bash
docker build -t syllacast:latest .
```

To run the container:
```bash
docker run -d \
  --name syllacast \
  -p 8080:8080 \
  -e SPICY_LYRICS_SECRET_KEY="your_api_key_here" \
  syllacast:latest
```

---

## 6. Static Musl Cross-Compilation via `cargo xtask dist`

Syllacast provides a unified, cross-platform build runner crate (`xtask`) that allows developers on Linux, macOS, or Windows to compile completely static, zero-glibc-dependency Linux binaries using [`cross`](https://github.com/cross-rs/cross) and Docker/Podman.

### Supported Distribution Targets
- `x86_64-unknown-linux-musl`: 64-bit x86 Linux desktops, servers, and VMs.
- `aarch64-unknown-linux-musl`: 64-bit ARM SBCs (Raspberry Pi 3/4/5 running 64-bit OS).
- `armv7-unknown-linux-musleabihf`: 32-bit ARM SBCs (Raspberry Pi 2/3/4 running standard 32-bit Raspberry Pi OS).

Musl builds eliminate runtime `glibc` version dependencies entirely, allowing binaries to run seamlessly across Debian, Alpine, Ubuntu, Arch, or custom embedded distributions without library conflicts.

### Prerequisites for Cross-Building
1. **Docker or Podman**: Must be running on the host system.
2. **`cross` CLI**:
   ```bash
   cargo install cross --git https://github.com/cross-rs/cross
   ```
   *(If `cross` is missing, `cargo xtask dist` will automatically detect it and print actionable installation instructions.)*

### Dist Commands

- **Build all 3 static Linux targets**:
  ```bash
  cargo xtask dist --all
  ```
- **Build a specific target**:
  ```bash
  cargo xtask dist --target aarch64-unknown-linux-musl
  ```
- **Skip frontend rebuild (if `frontend/dist` is already built)**:
  ```bash
  cargo xtask dist --all --no-frontend-build
  ```
- **Build only the frontend bundle**:
  ```bash
  cargo xtask build-frontend
  ```
- **Validate static linking of an existing binary**:
  ```bash
  cargo xtask validate-static ./dist/syllacast-x86_64-unknown-linux-musl.tar.gz
  ```

### What `cargo xtask dist` Does Automatically
1. **Frontend Compilation**: Executes `npm ci` and `npm run build` in `frontend/` if static assets are not up to date.
2. **Preflight Cross Verification**: Verifies `cross` is present in `PATH`.
3. **Containerized Musl Compilation**: Invokes `cross build --target <target> --release` configured via [`Cross.toml`](Cross.toml).
4. **ELF Static-Linking Validation**: Reads the ELF headers in pure Rust to strictly verify that no `PT_INTERP` segment exists (guaranteeing 100% static linking with no dynamic library interpreter).
5. **Distribution Packaging**: Creates `.tar.gz` archives in `dist/` containing:
   - `syllacast` (executable, mode `0755`)
   - `LICENSE` (AGPL-3.0)
   - `README.md`
   - `ATTRIBUTION.md`
6. **Integrity Checksums**: Generates and updates `dist/SHA256SUMS.txt`.

---

## 7. Packaging & GitHub Actions CI/CD

### Distribution Directory Structure
After running `cargo xtask dist --all`, the `dist/` folder contains:
```text
dist/
├── syllacast-x86_64-unknown-linux-musl.tar.gz
├── syllacast-aarch64-unknown-linux-musl.tar.gz
├── syllacast-armv7-unknown-linux-musleabihf.tar.gz
└── SHA256SUMS.txt
```

### GitHub Actions Workflows
Two automated workflows are configured under `.github/workflows/`:
1. **Continuous Integration (`ci.yml`)**:
   - Runs frontend linter, typecheck, and Vitest suite.
   - Runs `cargo check`, `cargo test`, and `cargo clippy -- -D warnings`.
   - **Cross-compile Guard**: Triggers full 3-target `cross` compilation when Rust dependencies or build configurations (`Cargo.lock`, `Cargo.toml`, `Cross.toml`, `xtask/**`) change, catching ARM/musl regressions early before release.
2. **Tagged Releases (`release.yml`)**:
   - Triggered on Git tags (`v*`).
   - Runs complete preflight tests before launching matrix builds.
   - Matrix builds all 3 musl targets using `cargo xtask dist`.
   - Generates signed build provenance and artifact integrity attestations via `actions/attest-build-provenance@v2`.
   - Publishes atomically only after all 3 targets succeed, attaching all archives, `SHA256SUMS.txt`, and direct AGPL-3.0 source code offers.

