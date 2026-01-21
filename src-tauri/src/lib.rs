use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(not(target_os = "windows"))]
use flate2::read::GzDecoder;
#[cfg(not(target_os = "windows"))]
use tar::Archive;

const CONFIG_FILENAME: &str = "config.json";
const WORLD_ENGINE_DIR: &str = "world_engine";
const SEEDS_DIR: &str = "seeds";
const UV_VERSION: &str = "0.9.26";
// Port 7987 = 'O' (79) + 'W' (87) in ASCII
const STANDALONE_PORT: u16 = 7987;

// Bundled server components (embedded at compile time)
const SERVER_PY: &str = include_str!("../server-components/server.py");
const PYPROJECT_TOML: &str = include_str!("../server-components/pyproject.toml");

/// Engine mode: how the World Engine server should be managed
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum EngineMode {
    /// User hasn't chosen yet - show the choice dialog
    #[default]
    Unchosen,
    /// Biome manages the World Engine automatically
    Standalone,
    /// User runs their own server
    Server,
}

// Global state for tracking the running server process
#[derive(Default)]
struct ServerState {
    process: Option<Child>,
    port: Option<u16>,
    ready: bool,
}

static SERVER_STATE: std::sync::OnceLock<Mutex<ServerState>> = std::sync::OnceLock::new();

fn get_server_state() -> &'static Mutex<ServerState> {
    SERVER_STATE.get_or_init(|| Mutex::new(ServerState::default()))
}

// Global app handle for emitting events from threads
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

fn get_app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}

/// Create a new Command with platform-specific flags to suppress console windows on Windows
fn new_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuServerConfig {
    pub host: String,
    pub port: u16,
    pub use_ssl: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiKeysConfig {
    pub openai: String,
    pub fal: String,
    #[serde(default)]
    pub huggingface: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FeaturesConfig {
    pub prompt_sanitizer: bool,
    pub seed_generation: bool,
    pub engine_mode: EngineMode,
    #[serde(default)]
    pub seed_gallery: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UiConfig {
    #[serde(default)]
    pub bottom_panel_hidden: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub gpu_server: GpuServerConfig,
    pub api_keys: ApiKeysConfig,
    pub features: FeaturesConfig,
    #[serde(default)]
    pub ui: UiConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            gpu_server: GpuServerConfig {
                host: "localhost".to_string(),
                port: STANDALONE_PORT,
                use_ssl: false,
            },
            api_keys: ApiKeysConfig {
                openai: String::new(),
                fal: String::new(),
                huggingface: String::new(),
            },
            features: FeaturesConfig {
                prompt_sanitizer: true,
                seed_generation: true,
                engine_mode: EngineMode::Unchosen,
                seed_gallery: false,
            },
            ui: UiConfig::default(),
        }
    }
}

fn get_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;

    // Create config directory if it doesn't exist
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    Ok(config_dir.join(CONFIG_FILENAME))
}

#[tauri::command]
fn read_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let config_path = get_config_path(&app)?;

    if !config_path.exists() {
        // Create default config file
        let default_config = AppConfig::default();
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize default config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write default config: {}", e))?;
        return Ok(default_config);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    // Try parsing as new format first
    if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
        return Ok(config);
    }

    // Try parsing as JSON Value to check for legacy format and migrate
    let mut json_value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))?;

    // Check for legacy use_standalone_engine boolean and migrate to engine_mode
    if let Some(features) = json_value.get_mut("features")
        && let Some(features_obj) = features.as_object_mut()
        && let Some(use_standalone) = features_obj.remove("use_standalone_engine")
    {
        // Migrate: true -> standalone, false -> server
        let engine_mode = if use_standalone.as_bool().unwrap_or(true) {
            "standalone"
        } else {
            "server"
        };
        features_obj.insert("engine_mode".to_string(), serde_json::json!(engine_mode));

        // Save migrated config
        let migrated_json = serde_json::to_string_pretty(&json_value)
            .map_err(|e| format!("Failed to serialize migrated config: {}", e))?;
        fs::write(&config_path, &migrated_json)
            .map_err(|e| format!("Failed to write migrated config: {}", e))?;

        println!(
            "[CONFIG] Migrated use_standalone_engine to engine_mode: {}",
            engine_mode
        );
    }

    // Now parse the (potentially migrated) JSON as AppConfig
    serde_json::from_value(json_value).map_err(|e| format!("Failed to parse config file: {}", e))
}

#[tauri::command]
fn write_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let config_path = get_config_path(&app)?;

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, json).map_err(|e| format!("Failed to write config file: {}", e))
}

#[tauri::command]
fn get_config_path_str(app: tauri::AppHandle) -> Result<String, String> {
    let config_path = get_config_path(&app)?;
    Ok(config_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_config(app: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_config_path(&app)?;

    // Ensure config file exists before opening
    if !config_path.exists() {
        // Create default config if it doesn't exist
        let default_config = AppConfig::default();
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize default config: {}", e))?;
        fs::write(&config_path, json)
            .map_err(|e| format!("Failed to write default config: {}", e))?;
    }

    // Open File Explorer with config file selected
    tauri_plugin_opener::reveal_item_in_dir(config_path)
        .map_err(|e| format!("Failed to reveal config file: {}", e))
}

// Get the engine directory path (inside app data dir)
fn get_engine_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Create data directory if it doesn't exist
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    }

    Ok(data_dir.join(WORLD_ENGINE_DIR))
}

// Get the .uv directory path for isolated uv installation
fn get_uv_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(data_dir.join(".uv"))
}

// Get the path to our local uv binary
fn get_uv_binary_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let uv_dir = get_uv_dir(app)?;
    let bin_dir = uv_dir.join("bin");

    #[cfg(target_os = "windows")]
    {
        Ok(bin_dir.join("uv.exe"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(bin_dir.join("uv"))
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct EngineStatus {
    pub uv_installed: bool,
    pub repo_cloned: bool,
    pub dependencies_synced: bool,
    pub engine_dir: String,
    pub server_running: bool,
    pub server_port: Option<u16>,
    pub server_log_path: String,
}

#[tauri::command]
async fn check_engine_status(app: tauri::AppHandle) -> Result<EngineStatus, String> {
    let engine_dir = get_engine_dir(&app)?;
    let uv_binary = get_uv_binary_path(&app)?;
    let uv_dir = get_uv_dir(&app)?;

    // Check if our local uv binary exists and works
    let uv_installed = uv_binary.exists()
        && new_command(&uv_binary)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

    // Check if server components are installed (look for server.py as indicator)
    let repo_cloned = engine_dir.exists()
        && engine_dir.join("pyproject.toml").exists()
        && engine_dir.join("server.py").exists();

    // Check if dependencies are synced by verifying .venv exists and has a working Python
    // This catches cases where sync failed partway through
    let dependencies_synced = if repo_cloned && engine_dir.join(".venv").exists() {
        // Verify the venv has a working Python interpreter
        #[cfg(target_os = "windows")]
        let python_path = engine_dir.join(".venv").join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = engine_dir.join(".venv").join("bin").join("python");

        if python_path.exists() {
            // Try to run the Python interpreter to verify it works
            new_command(&uv_binary)
                .current_dir(&engine_dir)
                .arg("run")
                .arg("python")
                .arg("--version")
                .env("UV_CACHE_DIR", uv_dir.join("cache"))
                .env("UV_FROZEN", "1")
                .env("UV_NO_CONFIG", "1")
                .env("UV_PYTHON_INSTALL_DIR", uv_dir.join("python_install"))
                .env("UV_PYTHON_BIN_DIR", uv_dir.join("python_bin"))
                .env("UV_TOOL_DIR", uv_dir.join("tool"))
                .env("UV_TOOL_BIN_DIR", uv_dir.join("tool_bin"))
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        } else {
            false
        }
    } else {
        false
    };

    // Check if server is running
    let (server_running, server_port) = {
        let state = get_server_state().lock().unwrap();
        let running = state.process.is_some();
        let port = state.port;
        (running, port)
    };

    let server_log_path = engine_dir.join("server.log").to_string_lossy().to_string();

    Ok(EngineStatus {
        uv_installed,
        repo_cloned,
        dependencies_synced,
        engine_dir: engine_dir.to_string_lossy().to_string(),
        server_running,
        server_port,
        server_log_path,
    })
}

#[tauri::command]
async fn install_uv(app: tauri::AppHandle) -> Result<String, String> {
    let uv_dir = get_uv_dir(&app)?;
    let bin_dir = uv_dir.join("bin");

    // Create bin directory
    fs::create_dir_all(&bin_dir).map_err(|e| format!("Failed to create uv bin dir: {}", e))?;

    // Determine the download URL based on platform and architecture
    let (archive_name, _binary_name) = get_uv_archive_info();
    let download_url = format!(
        "https://github.com/astral-sh/uv/releases/download/{}/{}",
        UV_VERSION, archive_name
    );

    // Download using async reqwest
    let response = reqwest::get(&download_url)
        .await
        .map_err(|e| format!("Failed to download uv: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Failed to download uv: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Extract based on platform
    #[cfg(target_os = "windows")]
    {
        extract_zip(&bytes, &uv_dir, &bin_dir)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        extract_tar_gz(&bytes, &uv_dir, &bin_dir)?;
    }

    Ok(format!("uv {} installed successfully", UV_VERSION))
}

// Get the archive name and binary name based on platform
fn get_uv_archive_info() -> (&'static str, &'static str) {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        ("uv-x86_64-pc-windows-msvc.zip", "uv.exe")
    }

    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        ("uv-aarch64-pc-windows-msvc.zip", "uv.exe")
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        ("uv-x86_64-apple-darwin.tar.gz", "uv")
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        ("uv-aarch64-apple-darwin.tar.gz", "uv")
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        ("uv-x86_64-unknown-linux-gnu.tar.gz", "uv")
    }

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        ("uv-aarch64-unknown-linux-gnu.tar.gz", "uv")
    }
}

#[cfg(target_os = "windows")]
fn extract_zip(bytes: &[u8], _uv_dir: &Path, bin_dir: &Path) -> Result<(), String> {
    let cursor = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let name = file.name().to_string();

        // We only care about uv.exe
        if name.ends_with("uv.exe") {
            let dest_path = bin_dir.join("uv.exe");
            let mut dest_file =
                File::create(&dest_path).map_err(|e| format!("Failed to create uv.exe: {}", e))?;

            io::copy(&mut file, &mut dest_file)
                .map_err(|e| format!("Failed to write uv.exe: {}", e))?;

            break;
        }
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn extract_tar_gz(bytes: &[u8], _uv_dir: &Path, bin_dir: &Path) -> Result<(), String> {
    let cursor = Cursor::new(bytes);
    let gz = GzDecoder::new(cursor);
    let mut archive = Archive::new(gz);

    let entries = archive
        .entries()
        .map_err(|e| format!("Failed to read tar archive: {}", e))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Failed to read tar entry: {}", e))?;
        let path = entry
            .path()
            .map_err(|e| format!("Failed to get entry path: {}", e))?;

        let path_str = path.to_string_lossy();

        // We only care about the uv binary (not uvx)
        if path_str.ends_with("/uv") && !path_str.ends_with("/uvx") {
            let dest_path = bin_dir.join("uv");
            let mut dest_file = File::create(&dest_path)
                .map_err(|e| format!("Failed to create uv binary: {}", e))?;

            io::copy(&mut entry, &mut dest_file)
                .map_err(|e| format!("Failed to write uv binary: {}", e))?;

            // Make executable on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = dest_file
                    .metadata()
                    .map_err(|e| format!("Failed to get metadata: {}", e))?
                    .permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&dest_path, perms)
                    .map_err(|e| format!("Failed to set permissions: {}", e))?;
            }

            break;
        }
    }

    Ok(())
}

#[tauri::command]
async fn setup_server_components(app: tauri::AppHandle) -> Result<String, String> {
    let engine_dir = get_engine_dir(&app)?;

    // Create engine directory if it doesn't exist
    fs::create_dir_all(&engine_dir).map_err(|e| format!("Failed to create engine dir: {}", e))?;

    // Write bundled server.py
    fs::write(engine_dir.join("server.py"), SERVER_PY)
        .map_err(|e| format!("Failed to write server.py: {}", e))?;

    // Write bundled pyproject.toml
    fs::write(engine_dir.join("pyproject.toml"), PYPROJECT_TOML)
        .map_err(|e| format!("Failed to write pyproject.toml: {}", e))?;

    Ok("Server components installed".to_string())
}

#[tauri::command]
async fn sync_engine_dependencies(app: tauri::AppHandle) -> Result<String, String> {
    let engine_dir = get_engine_dir(&app)?;
    let uv_dir = get_uv_dir(&app)?;

    if !engine_dir.exists() {
        return Err("Engine repository not found. Please clone it first.".to_string());
    }

    // Create .uv directories
    fs::create_dir_all(uv_dir.join("cache"))
        .map_err(|e| format!("Failed to create uv cache dir: {}", e))?;
    fs::create_dir_all(uv_dir.join("python_install"))
        .map_err(|e| format!("Failed to create uv python_install dir: {}", e))?;
    fs::create_dir_all(uv_dir.join("python_bin"))
        .map_err(|e| format!("Failed to create uv python_bin dir: {}", e))?;
    fs::create_dir_all(uv_dir.join("tool"))
        .map_err(|e| format!("Failed to create uv tool dir: {}", e))?;
    fs::create_dir_all(uv_dir.join("tool_bin"))
        .map_err(|e| format!("Failed to create uv tool_bin dir: {}", e))?;

    // Get our local uv binary path
    let uv_binary = get_uv_binary_path(&app)?;

    if !uv_binary.exists() {
        return Err("uv is not installed. Please install it first.".to_string());
    }

    // Run uv sync with the specified environment variables
    // Note: Not using UV_FROZEN since we install world_engine from git without a lockfile
    let output = new_command(&uv_binary)
        .current_dir(&engine_dir)
        .arg("sync")
        .arg("--index-strategy")
        .arg("unsafe-best-match")
        .env("UV_LINK_MODE", "copy")
        .env("UV_NO_EDITABLE", "1")
        .env("UV_MANAGED_PYTHON", "1")
        .env("UV_CACHE_DIR", uv_dir.join("cache"))
        .env("UV_PYTHON_INSTALL_DIR", uv_dir.join("python_install"))
        .env("UV_PYTHON_BIN_DIR", uv_dir.join("python_bin"))
        .env("UV_TOOL_DIR", uv_dir.join("tool"))
        .env("UV_TOOL_BIN_DIR", uv_dir.join("tool_bin"))
        .output()
        .map_err(|e| format!("Failed to run uv sync: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "uv sync failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok("Dependencies synced successfully".to_string())
}

#[tauri::command]
async fn setup_engine(app: tauri::AppHandle) -> Result<String, String> {
    // Step 1: Check/install uv
    let uv_binary = get_uv_binary_path(&app)?;

    if !uv_binary.exists() {
        install_uv(app.clone()).await?;
    }

    // Step 2: Setup server components (bundled pyproject.toml + server.py) - force overwrite
    unpack_server_files_inner(&app, true)?;

    // Step 3: Sync dependencies (installs world_engine from git)
    sync_engine_dependencies(app).await?;

    Ok("Engine setup complete".to_string())
}

/// Unpack bundled server files to the engine directory.
/// If force is false, only unpacks files that don't already exist.
/// If force is true, always overwrites existing files.
fn unpack_server_files_inner(app: &tauri::AppHandle, force: bool) -> Result<String, String> {
    let engine_dir = get_engine_dir(app)?;

    // Create engine directory if it doesn't exist
    fs::create_dir_all(&engine_dir).map_err(|e| format!("Failed to create engine dir: {}", e))?;

    let server_py_path = engine_dir.join("server.py");
    let pyproject_path = engine_dir.join("pyproject.toml");

    let mut unpacked = Vec::new();

    // Only write if file doesn't exist OR force is true
    if force || !server_py_path.exists() {
        fs::write(&server_py_path, SERVER_PY)
            .map_err(|e| format!("Failed to write server.py: {}", e))?;
        unpacked.push("server.py");
    }

    if force || !pyproject_path.exists() {
        fs::write(&pyproject_path, PYPROJECT_TOML)
            .map_err(|e| format!("Failed to write pyproject.toml: {}", e))?;
        unpacked.push("pyproject.toml");
    }

    if unpacked.is_empty() {
        Ok("Files already exist, skipped unpacking".to_string())
    } else {
        Ok(format!("Unpacked: {}", unpacked.join(", ")))
    }
}

#[tauri::command]
async fn unpack_server_files(app: tauri::AppHandle, force: bool) -> Result<String, String> {
    unpack_server_files_inner(&app, force)
}

#[tauri::command]
fn get_engine_dir_path(app: tauri::AppHandle) -> Result<String, String> {
    let engine_dir = get_engine_dir(&app)?;
    Ok(engine_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_engine_dir(app: tauri::AppHandle) -> Result<(), String> {
    let engine_dir = get_engine_dir(&app)?;

    // Create directory if it doesn't exist
    if !engine_dir.exists() {
        fs::create_dir_all(&engine_dir)
            .map_err(|e| format!("Failed to create engine dir: {}", e))?;
    }

    // Open File Explorer with engine directory
    tauri_plugin_opener::reveal_item_in_dir(engine_dir)
        .map_err(|e| format!("Failed to open engine directory: {}", e))
}

// ============================================================================
// Seeds Management
// ============================================================================

// Get the seeds directory path (inside app data dir)
fn get_seeds_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(data_dir.join(SEEDS_DIR))
}

/// Initialize seeds by copying bundled seeds to app_data_dir/seeds/ on first run
#[tauri::command]
async fn initialize_seeds(app: tauri::AppHandle) -> Result<String, String> {
    let seeds_dir = get_seeds_dir(&app)?;

    // Create seeds directory if it doesn't exist
    if !seeds_dir.exists() {
        fs::create_dir_all(&seeds_dir).map_err(|e| format!("Failed to create seeds dir: {}", e))?;
    }

    // Get the resource path for bundled seeds (production)
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let bundled_seeds_dir = resource_path.join("seeds");

    // In development, try multiple possible locations for the seeds folder
    let cwd = std::env::current_dir().ok();
    let dev_candidates: Vec<PathBuf> = cwd
        .iter()
        .flat_map(|cwd| {
            vec![
                cwd.join("seeds"),                                         // If cwd is project root
                cwd.join("..").join("seeds"),                              // If cwd is src-tauri
                cwd.parent().map(|p| p.join("seeds")).unwrap_or_default(), // Parent of cwd
            ]
        })
        .filter(|p| p.exists() && p.is_dir())
        .collect();

    let source_dir = if bundled_seeds_dir.exists() {
        Some(bundled_seeds_dir)
    } else {
        dev_candidates.into_iter().next()
    };

    let mut copied_count = 0;

    if let Some(source) = source_dir
        && let Ok(entries) = fs::read_dir(&source)
    {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if (ext_lower == "png" || ext_lower == "jpg" || ext_lower == "jpeg")
                    && let Some(filename) = path.file_name()
                {
                    let dest_path = seeds_dir.join(filename);
                    if !dest_path.exists() && fs::copy(&path, &dest_path).is_ok() {
                        copied_count += 1;
                    }
                }
            }
        }
    }

    Ok(format!(
        "Seeds initialized: {} new files copied to {}",
        copied_count,
        seeds_dir.display()
    ))
}

/// List available seed filenames (png/jpg/jpeg)
#[tauri::command]
async fn list_seeds(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let seeds_dir = get_seeds_dir(&app)?;

    if !seeds_dir.exists() {
        return Ok(Vec::new());
    }

    let mut seeds = Vec::new();

    let entries =
        fs::read_dir(&seeds_dir).map_err(|e| format!("Failed to read seeds dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            let ext_lower = ext.to_string_lossy().to_lowercase();
            if (ext_lower == "png" || ext_lower == "jpg" || ext_lower == "jpeg")
                && let Some(filename) = path.file_name()
            {
                seeds.push(filename.to_string_lossy().to_string());
            }
        }
    }

    Ok(seeds)
}

/// Read a seed file and return base64 encoded data
#[tauri::command]
async fn read_seed_as_base64(app: tauri::AppHandle, filename: String) -> Result<String, String> {
    let seeds_dir = get_seeds_dir(&app)?;
    let seed_path = seeds_dir.join(&filename);

    if !seed_path.exists() {
        return Err(format!("Seed file not found: {}", filename));
    }

    // Validate that the file is within the seeds directory (prevent path traversal)
    let canonical_seeds = seeds_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize seeds dir: {}", e))?;
    let canonical_seed = seed_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize seed path: {}", e))?;

    if !canonical_seed.starts_with(&canonical_seeds) {
        return Err("Invalid seed path".to_string());
    }

    let mut file =
        File::open(&seed_path).map_err(|e| format!("Failed to open seed file: {}", e))?;

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|e| format!("Failed to read seed file: {}", e))?;

    Ok(BASE64_STANDARD.encode(&buffer))
}

/// Read a seed file and return a small thumbnail as base64 encoded JPEG
#[tauri::command]
async fn read_seed_thumbnail(
    app: tauri::AppHandle,
    filename: String,
    max_size: Option<u32>,
) -> Result<String, String> {
    let seeds_dir = get_seeds_dir(&app)?;
    let seed_path = seeds_dir.join(&filename);

    if !seed_path.exists() {
        return Err(format!("Seed file not found: {}", filename));
    }

    // Validate path
    let canonical_seeds = seeds_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize seeds dir: {}", e))?;
    let canonical_seed = seed_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize seed path: {}", e))?;

    if !canonical_seed.starts_with(&canonical_seeds) {
        return Err("Invalid seed path".to_string());
    }

    // Load and resize image
    let img = image::open(&seed_path).map_err(|e| format!("Failed to open image: {}", e))?;

    let max_dim = max_size.unwrap_or(80);
    let thumbnail = img.thumbnail(max_dim, max_dim);

    // Encode as JPEG
    let mut buffer = Vec::new();
    let mut cursor = Cursor::new(&mut buffer);
    thumbnail
        .write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    Ok(BASE64_STANDARD.encode(&buffer))
}

/// Get the seeds directory path
#[tauri::command]
fn get_seeds_dir_path(app: tauri::AppHandle) -> Result<String, String> {
    let seeds_dir = get_seeds_dir(&app)?;
    Ok(seeds_dir.to_string_lossy().to_string())
}

/// Open the seeds directory in file explorer
#[tauri::command]
async fn open_seeds_dir(app: tauri::AppHandle) -> Result<(), String> {
    let seeds_dir = get_seeds_dir(&app)?;

    // Create directory if it doesn't exist
    if !seeds_dir.exists() {
        fs::create_dir_all(&seeds_dir).map_err(|e| format!("Failed to create seeds dir: {}", e))?;
    }

    // Open File Explorer with seeds directory
    tauri_plugin_opener::reveal_item_in_dir(seeds_dir)
        .map_err(|e| format!("Failed to open seeds directory: {}", e))
}

#[tauri::command]
async fn start_engine_server(app: tauri::AppHandle, port: u16) -> Result<String, String> {
    let engine_dir = get_engine_dir(&app)?;
    let uv_dir = get_uv_dir(&app)?;
    let uv_binary = get_uv_binary_path(&app)?;

    // Check if server is already running
    {
        let state = get_server_state().lock().unwrap();
        if state.process.is_some() {
            return Err(format!(
                "Server is already running on port {}",
                state.port.unwrap_or(0)
            ));
        }
    }

    // Verify dependencies are synced
    if !engine_dir.join(".venv").exists() {
        return Err("Engine dependencies not synced. Please run setup first.".to_string());
    }

    if !uv_binary.exists() {
        return Err("uv is not installed. Please install it first.".to_string());
    }

    // Reset ready state
    {
        let mut state = get_server_state().lock().unwrap();
        state.ready = false;
    }

    println!("[ENGINE] Starting server on port {}...", port);
    println!("[ENGINE] Engine dir: {:?}", engine_dir);
    println!("[ENGINE] UV binary: {:?}", uv_binary);

    // Run uv sync to ensure dependencies are up to date
    println!("[ENGINE] Syncing dependencies...");
    let sync_output = new_command(&uv_binary)
        .current_dir(&engine_dir)
        .arg("sync")
        .arg("--index-strategy")
        .arg("unsafe-best-match")
        .env("UV_CACHE_DIR", uv_dir.join("cache"))
        .env("UV_NO_CONFIG", "1")
        .env("UV_PYTHON_INSTALL_DIR", uv_dir.join("python_install"))
        .env("UV_PYTHON_BIN_DIR", uv_dir.join("python_bin"))
        .env("UV_TOOL_DIR", uv_dir.join("tool"))
        .env("UV_TOOL_BIN_DIR", uv_dir.join("tool_bin"))
        .output()
        .map_err(|e| format!("Failed to run uv sync: {}", e))?;

    if !sync_output.status.success() {
        let stderr = String::from_utf8_lossy(&sync_output.stderr);
        println!("[ENGINE] Warning: uv sync failed: {}", stderr);
        // Don't fail here - maybe deps are already synced
    } else {
        println!("[ENGINE] Dependencies synced successfully");
    }

    // Create log file for server output
    let log_file_path = engine_dir.join("server.log");
    println!(
        "[ENGINE] Server logs will be written to: {:?}",
        log_file_path
    );

    // Spawn the server process with piped stdout/stderr so we can tee to console and file
    // Command: uv run python server.py --port <port>
    let mut cmd = new_command(&uv_binary);
    cmd.current_dir(&engine_dir)
        .arg("run")
        .arg("python")
        .arg("-u") // Unbuffered output for real-time logging
        .arg("server.py")
        .arg("--port")
        .arg(port.to_string())
        .env("UV_CACHE_DIR", uv_dir.join("cache"))
        .env("UV_NO_CONFIG", "1")
        .env("UV_PYTHON_INSTALL_DIR", uv_dir.join("python_install"))
        .env("UV_PYTHON_BIN_DIR", uv_dir.join("python_bin"))
        .env("UV_TOOL_DIR", uv_dir.join("tool"))
        .env("UV_TOOL_BIN_DIR", uv_dir.join("tool_bin"))
        .env("PYTHONUNBUFFERED", "1") // Ensure Python output is unbuffered
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Pass through HuggingFace token - first check config, then fall back to environment
    let config = read_config(app.clone()).unwrap_or_default();
    let hf_token = if !config.api_keys.huggingface.is_empty() {
        Some(config.api_keys.huggingface.clone())
    } else if let Ok(token) = std::env::var("HF_TOKEN") {
        Some(token)
    } else {
        std::env::var("HUGGING_FACE_HUB_TOKEN").ok()
    };

    if let Some(token) = hf_token {
        println!(
            "[ENGINE] HuggingFace token configured ({}... chars)",
            token.len().min(4)
        );
        cmd.env("HF_TOKEN", &token);
        cmd.env("HUGGING_FACE_HUB_TOKEN", &token);
    } else {
        println!("[ENGINE] Warning: No HuggingFace token configured");
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    let pid = child.id();
    println!("[ENGINE] Server process spawned with PID: {}", pid);

    // Set up tee: pipe stdout/stderr to both console and log file
    let log_file_path_clone = log_file_path.clone();

    // Take ownership of stdout/stderr from child
    let child_stdout = child.stdout.take();
    let child_stderr = child.stderr.take();

    // Helper function to process log lines - emits events and detects server ready
    fn process_log_line(line: &str, is_stderr: bool) {
        // Print to console
        if is_stderr {
            eprintln!("[SERVER] {}", line);
        } else {
            println!("[SERVER] {}", line);
        }

        // Emit event to frontend
        if let Some(app) = get_app_handle() {
            let _ = app.emit("server-log", line);
        }

        // Check if server is ready (look for the ready message)
        if line.contains("SERVER READY") || line.contains("Uvicorn running on") {
            println!("[ENGINE] Server ready signal detected!");
            let mut state = get_server_state().lock().unwrap();
            state.ready = true;
            // Emit ready event
            if let Some(app) = get_app_handle() {
                let _ = app.emit("server-ready", true);
            }
        }
    }

    // Spawn thread to tee stdout to console, log file, and emit events
    if let Some(stdout) = child_stdout {
        let log_path = log_file_path_clone.clone();
        std::thread::spawn(move || {
            let mut log_file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .ok();

            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                process_log_line(&line, false);
                if let Some(ref mut file) = log_file {
                    let _ = writeln!(file, "{}", line);
                    let _ = file.flush();
                }
            }
        });
    }

    // Spawn thread to tee stderr to console, log file, and emit events
    if let Some(stderr) = child_stderr {
        let log_path = log_file_path_clone;
        std::thread::spawn(move || {
            let mut log_file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .ok();

            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                process_log_line(&line, true);
                if let Some(ref mut file) = log_file {
                    let _ = writeln!(file, "{}", line);
                    let _ = file.flush();
                }
            }
        });
    }

    // Store the process handle
    {
        let mut state = get_server_state().lock().unwrap();
        state.process = Some(child);
        state.port = Some(port);
    }

    // Wait a moment and check if the process crashed immediately
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Check if process is still running
    {
        let mut state = get_server_state().lock().unwrap();
        if let Some(ref mut process) = state.process {
            match process.try_wait() {
                Ok(Some(exit_status)) => {
                    // Process exited - read the log file for error details
                    state.process = None;
                    state.port = None;

                    // Give the tee threads a moment to flush
                    std::thread::sleep(std::time::Duration::from_millis(100));

                    let log_contents = fs::read_to_string(&log_file_path)
                        .unwrap_or_else(|_| "Unable to read log file".to_string());

                    // Extract the last part of the log (likely contains the error)
                    let error_excerpt: String = log_contents
                        .lines()
                        .rev()
                        .take(30)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join("\n");

                    return Err(format!(
                        "Server process exited immediately with status: {}\n\nLast log output:\n{}",
                        exit_status, error_excerpt
                    ));
                }
                Ok(None) => {
                    // Process is still running - good!
                    println!("[ENGINE] Server process is running");
                }
                Err(e) => {
                    println!("[ENGINE] Warning: Could not check process status: {}", e);
                }
            }
        }
    }

    Ok(format!("Server started on port {} (PID: {})", port, pid))
}

// Core sync function to stop the server - used by both the command and cleanup
fn stop_server_sync() -> Result<String, String> {
    let mut state = get_server_state().lock().unwrap();

    if let Some(mut process) = state.process.take() {
        let pid = process.id();
        println!("[ENGINE] Stopping server process tree (PID: {})...", pid);

        // Kill entire process tree (handles uvicorn child processes)
        match kill_tree::blocking::kill_tree(pid) {
            Ok(outputs) => {
                println!("[ENGINE] Killed {} processes in tree", outputs.len());
            }
            Err(e) => {
                println!(
                    "[ENGINE] kill_tree failed, falling back to direct kill: {}",
                    e
                );
                let _ = process.kill();
            }
        }

        // Wait for our direct child to fully terminate
        let _ = process.wait();
        state.port = None;
        state.ready = false;
        println!("[ENGINE] Server stopped successfully");
        Ok(format!("Server stopped (PID: {})", pid))
    } else {
        Err("No server is currently running".to_string())
    }
}

#[tauri::command]
async fn stop_engine_server() -> Result<String, String> {
    stop_server_sync()
}

#[tauri::command]
async fn is_server_running() -> Result<bool, String> {
    let mut state = get_server_state().lock().unwrap();

    if let Some(ref mut process) = state.process {
        // Check if process is still running by trying to get its exit status
        match process.try_wait() {
            Ok(Some(_status)) => {
                // Process has exited
                state.process = None;
                state.port = None;
                Ok(false)
            }
            Ok(None) => {
                // Process is still running
                Ok(true)
            }
            Err(_) => {
                // Error checking - assume not running
                state.process = None;
                state.port = None;
                Ok(false)
            }
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn is_server_ready() -> bool {
    let state = get_server_state().lock().unwrap();
    state.ready
}

#[tauri::command]
fn is_port_in_use(port: u16) -> bool {
    use std::net::TcpListener;
    // Try to bind to the port - if it fails, port is in use
    TcpListener::bind(("127.0.0.1", port)).is_err()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Store app handle for event emission from threads
            set_app_handle(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            get_config_path_str,
            open_config,
            check_engine_status,
            install_uv,
            setup_server_components,
            sync_engine_dependencies,
            setup_engine,
            unpack_server_files,
            get_engine_dir_path,
            open_engine_dir,
            start_engine_server,
            stop_engine_server,
            is_server_running,
            is_server_ready,
            is_port_in_use,
            initialize_seeds,
            list_seeds,
            read_seed_as_base64,
            read_seed_thumbnail,
            get_seeds_dir_path,
            open_seeds_dir
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let RunEvent::Exit = event {
            let _ = stop_server_sync();
        }
    });
}
