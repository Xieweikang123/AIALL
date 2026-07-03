mod listing;
mod grep;
mod read_write;

pub use listing::{list_directory_impl, search_files_impl};
pub use grep::*;
pub use read_write::*;

use serde::Serialize;
use std::path::Path;

pub static IGNORE_DIRS: &[&str] = &[
  "node_modules", ".git", ".svn", ".hg", "__pycache__", ".cache",
  "dist", "build", ".next", ".nuxt", "target",
];

static HIDDEN_DOT_DIRS: &[&str] = &[
  ".git", ".svn", ".hg", ".vs", ".idea", ".cache", ".next", ".nuxt",
];

pub fn should_list_directory_entry(name: &str, is_directory: bool) -> bool {
  if IGNORE_DIRS.contains(&name) {
    return false;
  }
  if name.starts_with('.') {
    if is_directory {
      return !HIDDEN_DOT_DIRS.contains(&name);
    }
    return true;
  }
  true
}

pub static TEXT_EXTENSIONS: &[&str] = &[
  ".ts", ".tsx", ".js", ".jsx", ".vue", ".json", ".html", ".css", ".scss", ".less",
  ".md", ".txt", ".yaml", ".yml", ".toml", ".xml", ".svg", ".sql", ".sh", ".bash",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".php", ".swift", ".kt", ".r", ".m", ".mm", ".lua", ".pl",
  ".env", ".gitignore", ".dockerignore", ".editorconfig", ".prettierrc",
  ".eslintrc", ".babelrc", ".log", ".csv", ".ini", ".cfg",
  ".svelte", ".astro", ".mdx",
];

pub fn is_text_extension(ext: &str) -> bool {
  TEXT_EXTENSIONS.contains(&ext)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
  pub name: String,
  pub path: String,
  pub relative: String,
  pub is_directory: bool,
  pub is_file: bool,
  pub extension: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub size: Option<u64>,
}

pub async fn list_directory(dir_path: &str) -> Result<Vec<FileEntry>, String> {
  list_directory_impl(dir_path).await
}

pub async fn search_files(dir_path: &str, query: &str, max_results: usize) -> Result<Vec<FileEntry>, String> {
  search_files_impl(dir_path, query, max_results).await
}

pub async fn create_item(path: &str, is_directory: bool, content: Option<&str>) -> Result<String, String> {
  read_write::create_item_impl(path, is_directory, content).await
}

pub async fn delete_item(path: &str) -> Result<String, String> {
  read_write::delete_item_impl(path).await
}

pub async fn rename_item(from: &str, to: &str) -> Result<(String, String), String> {
  read_write::rename_item_impl(from, to).await
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_should_list_directory_entry_filters_ignored_dirs() {
    assert!(!should_list_directory_entry("node_modules", true));
    assert!(!should_list_directory_entry("node_modules", false));
    assert!(!should_list_directory_entry(".git", true));
    assert!(!should_list_directory_entry(".svn", true));
    assert!(!should_list_directory_entry("__pycache__", true));
    assert!(!should_list_directory_entry("dist", true));
    assert!(!should_list_directory_entry("build", true));
    assert!(!should_list_directory_entry("target", true));
  }

  #[test]
  fn test_should_list_directory_entry_allows_regular() {
    assert!(should_list_directory_entry("src", true));
    assert!(should_list_directory_entry("main.rs", false));
    assert!(should_list_directory_entry("Cargo.toml", false));
  }

  #[test]
  fn test_should_list_directory_entry_hidden_files_allowed() {
    assert!(should_list_directory_entry(".env", false));
    assert!(should_list_directory_entry(".gitignore", false));
    assert!(should_list_directory_entry(".prettierrc", false));
    assert!(should_list_directory_entry(".hidden_file", false));
  }

  #[test]
  fn test_should_list_directory_entry_hidden_dirs_filtered() {
    assert!(!should_list_directory_entry(".git", true));
    assert!(!should_list_directory_entry(".svn", true));
    assert!(!should_list_directory_entry(".hg", true));
    assert!(!should_list_directory_entry(".vs", true));
    assert!(!should_list_directory_entry(".idea", true));
    assert!(!should_list_directory_entry(".cache", true));
  }

  #[test]
  fn test_should_list_directory_entry_other_hidden_dirs_allowed() {
    assert!(should_list_directory_entry(".config", true));
    assert!(should_list_directory_entry(".local", true));
    assert!(should_list_directory_entry(".ssh", true));
  }

  #[test]
  fn test_is_text_extension_known() {
    assert!(is_text_extension(".rs"));
    assert!(is_text_extension(".ts"));
    assert!(is_text_extension(".tsx"));
    assert!(is_text_extension(".js"));
    assert!(is_text_extension(".vue"));
    assert!(is_text_extension(".py"));
    assert!(is_text_extension(".md"));
    assert!(is_text_extension(".json"));
    assert!(is_text_extension(".html"));
    assert!(is_text_extension(".css"));
    assert!(is_text_extension(".env"));
    assert!(is_text_extension(".gitignore"));
    assert!(is_text_extension(".yaml"));
    assert!(is_text_extension(".toml"));
    assert!(is_text_extension(".xml"));
    assert!(is_text_extension(".csv"));
    assert!(is_text_extension(".log"));
    assert!(is_text_extension(".ini"));
    assert!(is_text_extension(".svelte"));
    assert!(is_text_extension(".astro"));
    assert!(is_text_extension(".mdx"));
  }

  #[test]
  fn test_is_text_extension_binary() {
    assert!(!is_text_extension(".jpg"));
    assert!(!is_text_extension(".png"));
    assert!(!is_text_extension(".gif"));
    assert!(!is_text_extension(".exe"));
    assert!(!is_text_extension(".dll"));
    assert!(!is_text_extension(".so"));
    assert!(!is_text_extension(".dylib"));
    assert!(!is_text_extension(".zip"));
    assert!(!is_text_extension(".tar"));
    assert!(!is_text_extension(".gz"));
    assert!(!is_text_extension(".class"));
    assert!(!is_text_extension(".ttf"));
  }

  #[test]
  fn test_is_text_extension_edge_cases() {
    assert!(!is_text_extension(""));
    assert!(!is_text_extension("rs"));
    assert!(!is_text_extension(".RS"));
  }
}
