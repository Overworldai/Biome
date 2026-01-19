use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, Cursor};
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

#[cfg(not(target_os = "windows"))]
use flate2::read::GzDecoder;
#[cfg(not(target_os = "windows"))]
use tar::Archive;

const CONFIG_FILENAME: &str = "config.json";
const WORLD_ENGINE_ZIP_URL: &str =
    "https://github.com/Wayfarer-Labs/world_engine/archive/refs/heads/biome-stable.zip";
const WORLD_ENGINE_DIR: &str = "world_engine";
const UV_VERSION: &str = "0.9.26";

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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FeaturesConfig {
    pub prompt_sanitizer: bool,
    pub seed_generation: bool,
    pub use_standalone_engine: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub gpu_server: GpuServerConfig,
    pub api_keys: ApiKeysConfig,
    pub features: FeaturesConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            gpu_server: GpuServerConfig {
                host: "localhost".to_string(),
                port: 8082,
                use_ssl: false,
            },
            api_keys: ApiKeysConfig {
                openai: String::new(),
                fal: String::new(),
            },
            features: FeaturesConfig {
                prompt_sanitizer: true,
                seed_generation: true,
                use_standalone_engine: true,
            },
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

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config file: {}", e))
}

#[tauri::command]
fn write_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let config_path = get_config_path(&app)?;

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config file: {}", e))
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
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data dir: {}", e))?;
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
}

#[tauri::command]
async fn check_engine_status(app: tauri::AppHandle) -> Result<EngineStatus, String> {
    let engine_dir = get_engine_dir(&app)?;
    let uv_binary = get_uv_binary_path(&app)?;
    let uv_dir = get_uv_dir(&app)?;

    // Check if our local uv binary exists and works
    let uv_installed = uv_binary.exists() && Command::new(&uv_binary)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    // Check if repo is downloaded (look for pyproject.toml as indicator)
    let repo_cloned = engine_dir.exists() && engine_dir.join("pyproject.toml").exists();

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
            Command::new(&uv_binary)
                .current_dir(&engine_dir)
                .arg("run")
                .arg("python")
                .arg("--version")
                .env("UV_FROZEN", "1")
                .env("UV_NO_CONFIG", "1")
                .env("UV_CACHE_DIR", uv_dir.join("cache"))
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

    Ok(EngineStatus {
        uv_installed,
        repo_cloned,
        dependencies_synced,
        engine_dir: engine_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn install_uv(app: tauri::AppHandle) -> Result<String, String> {
    let uv_dir = get_uv_dir(&app)?;
    let bin_dir = uv_dir.join("bin");

    // Create bin directory
    fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("Failed to create uv bin dir: {}", e))?;

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
        return Err(format!(
            "Failed to download uv: HTTP {}",
            response.status()
        ));
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
fn extract_zip(bytes: &[u8], _uv_dir: &PathBuf, bin_dir: &PathBuf) -> Result<(), String> {
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let name = file.name().to_string();

        // We only care about uv.exe
        if name.ends_with("uv.exe") {
            let dest_path = bin_dir.join("uv.exe");
            let mut dest_file = File::create(&dest_path)
                .map_err(|e| format!("Failed to create uv.exe: {}", e))?;

            io::copy(&mut file, &mut dest_file)
                .map_err(|e| format!("Failed to write uv.exe: {}", e))?;

            break;
        }
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn extract_tar_gz(bytes: &[u8], _uv_dir: &PathBuf, bin_dir: &PathBuf) -> Result<(), String> {
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
async fn clone_engine_repo(app: tauri::AppHandle) -> Result<String, String> {
    let engine_dir = get_engine_dir(&app)?;

    // If directory exists with pyproject.toml, remove it to re-download fresh
    if engine_dir.exists() && engine_dir.join("pyproject.toml").exists() {
        fs::remove_dir_all(&engine_dir)
            .map_err(|e| format!("Failed to remove old engine dir: {}", e))?;
    }

    // Download the zip archive using async reqwest
    let response = reqwest::get(WORLD_ENGINE_ZIP_URL)
        .await
        .map_err(|e| format!("Failed to download world_engine: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download world_engine: HTTP {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Extract the zip archive
    let cursor = Cursor::new(&bytes[..]);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    // Extract to data dir (will create world_engine-biome-stable folder)
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let outpath = match file.enclosed_name() {
            Some(path) => {
                // GitHub archives have format: repo-branch/...
                // We need to strip the first component and replace with our dir name
                let components: Vec<_> = path.components().collect();
                if components.is_empty() {
                    continue;
                }

                // Skip the first component (world_engine-biome-stable) and rebuild path
                if components.len() == 1 {
                    // This is just the root folder, skip it
                    continue;
                }

                let mut new_path = engine_dir.clone();
                for component in components.iter().skip(1) {
                    new_path.push(component);
                }
                new_path
            }
            None => continue,
        };

        if file.name().ends_with('/') {
            // Directory
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create dir {}: {}", outpath.display(), e))?;
        } else {
            // File
            if let Some(parent) = outpath.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent dir: {}", e))?;
                }
            }

            let mut outfile = File::create(&outpath)
                .map_err(|e| format!("Failed to create file {}: {}", outpath.display(), e))?;

            io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to write file {}: {}", outpath.display(), e))?;

            // Set executable permissions on Unix for scripts
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    fs::set_permissions(&outpath, fs::Permissions::from_mode(mode)).ok();
                }
            }
        }
    }

    Ok("Repository downloaded successfully".to_string())
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
    let output = Command::new(&uv_binary)
        .current_dir(&engine_dir)
        .arg("sync")
        .env("UV_FROZEN", "1")
        .env("UV_LINK_MODE", "copy")
        .env("UV_NO_CONFIG", "1")
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

    // Step 2: Clone/update repo
    clone_engine_repo(app.clone()).await?;

    // Step 3: Sync dependencies
    sync_engine_dependencies(app).await?;

    Ok("Engine setup complete".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            get_config_path_str,
            open_config,
            check_engine_status,
            install_uv,
            clone_engine_repo,
            sync_engine_dependencies,
            setup_engine
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
