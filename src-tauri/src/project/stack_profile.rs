use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStackProfile {
  pub languages: Vec<String>,
  pub runtimes: Vec<String>,
  pub frameworks: Vec<String>,
  pub capabilities: Vec<String>,
  pub manifest_files: Vec<String>,
  pub entry_hints: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinimalProjectContextRoute {
  pub path: String,
  pub component: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub desc: Option<String>,
}

fn dedupe(values: Vec<String>) -> Vec<String> {
  values.into_iter().collect::<BTreeSet<_>>().into_iter().collect()
}

fn read_json_file(path: &Path) -> Option<Value> {
  let raw = fs::read_to_string(path).ok()?;
  serde_json::from_str(&raw).ok()
}

fn detect_from_package_json(project_root: &Path, profile: &mut ProjectStackProfile) {
  let pkg_path = project_root.join("package.json");
  if !pkg_path.is_file() {
    return;
  }
  profile.manifest_files.push("package.json".to_string());
  let Some(pkg) = read_json_file(&pkg_path) else {
    return;
  };
  let mut dep_names = Vec::new();
  let mut vue_version = String::new();
  for key in ["dependencies", "devDependencies"] {
    if let Some(deps) = pkg.get(key).and_then(|v| v.as_object()) {
      for (name, version) in deps {
        dep_names.push(name.to_lowercase());
        if name.eq_ignore_ascii_case("vue") {
          vue_version = version.as_str().unwrap_or("").to_string();
        }
      }
    }
  }
  if dep_names.iter().any(|d| d == "vue" || d.starts_with("@vue/")) {
    profile.frameworks.push(if vue_version.starts_with('3') || vue_version.contains("^3") {
      "vue3".to_string()
    } else {
      "vue".to_string()
    });
  }
  if dep_names.iter().any(|d| d == "react" || d.starts_with("@react")) {
    profile.frameworks.push("react".to_string());
  }
  if dep_names.iter().any(|d| d.contains("tauri") || d.starts_with("@tauri-apps/")) {
    profile.frameworks.push("tauri".to_string());
    profile.runtimes.push("desktop-shell".to_string());
  }
  if dep_names.iter().any(|d| d.contains("electron")) {
    profile.frameworks.push("electron".to_string());
    profile.runtimes.push("desktop-shell".to_string());
  }
  if dep_names.iter().any(|d| *d == "typescript" || d.starts_with("@types/")) {
    profile.languages.push("typescript".to_string());
  }
  if dep_names.iter().any(|d| {
    matches!(d.as_str(), "node-cron" | "cron" | "bull" | "agenda")
  }) {
    profile.capabilities.push("scheduled-tasks".to_string());
  }
  if dep_names.iter().any(|d| d.contains("@nestjs/schedule")) {
    profile.frameworks.push("nestjs".to_string());
    profile.capabilities.push("scheduled-tasks".to_string());
  }
  profile.runtimes.push("node".to_string());
}

fn detect_from_csproj(project_root: &Path, profile: &mut ProjectStackProfile) {
  let Ok(entries) = fs::read_dir(project_root) else {
    return;
  };
  let csproj_files: Vec<String> = entries
    .flatten()
    .map(|e| e.file_name().to_string_lossy().into_owned())
    .filter(|name| name.ends_with(".csproj"))
    .collect();
  if csproj_files.is_empty() {
    return;
  }
  profile.languages.push("csharp".to_string());
  profile.runtimes.push("dotnet".to_string());
  profile.manifest_files.extend(csproj_files.clone());
  let csproj_text = fs::read_to_string(project_root.join(&csproj_files[0])).unwrap_or_default();
  if csproj_text.contains("Microsoft.AspNetCore") || csproj_text.contains("Microsoft.NET.Sdk.Web") {
    profile.frameworks.push("aspnet-core".to_string());
  } else {
    profile.frameworks.push("dotnet".to_string());
  }
  if csproj_text.contains("Quartz") {
    profile.frameworks.push("quartz-net".to_string());
    profile.capabilities.push("scheduled-tasks".to_string());
  }
  if csproj_text.contains("Hangfire") {
    profile.frameworks.push("hangfire".to_string());
    profile.capabilities.push("scheduled-tasks".to_string());
  }
  for entry in ["Program.cs", "Startup.cs"] {
    if project_root.join(entry).is_file() {
      profile.entry_hints.push(entry.to_string());
    }
  }
}

fn detect_from_other_manifests(project_root: &Path, profile: &mut ProjectStackProfile) {
  for (file, language) in [
    ("Cargo.toml", "rust"),
    ("go.mod", "go"),
    ("pyproject.toml", "python"),
    ("requirements.txt", "python"),
  ] {
    if project_root.join(file).is_file() {
      profile.manifest_files.push(file.to_string());
      profile.languages.push(language.to_string());
    }
  }
  if project_root.join("src-tauri").is_dir() {
    profile.runtimes.push("desktop-shell".to_string());
    if !profile.frameworks.iter().any(|f| f == "tauri") {
      profile.frameworks.push("tauri".to_string());
    }
  }
}

pub fn detect_project_stack_profile(project_root: &str) -> ProjectStackProfile {
  let root = Path::new(project_root);
  let mut profile = ProjectStackProfile {
    languages: Vec::new(),
    runtimes: Vec::new(),
    frameworks: Vec::new(),
    capabilities: Vec::new(),
    manifest_files: Vec::new(),
    entry_hints: Vec::new(),
  };
  detect_from_package_json(root, &mut profile);
  detect_from_csproj(root, &mut profile);
  detect_from_other_manifests(root, &mut profile);
  profile.languages = dedupe(profile.languages);
  profile.runtimes = dedupe(profile.runtimes);
  profile.frameworks = dedupe(profile.frameworks);
  profile.capabilities = dedupe(profile.capabilities);
  profile.manifest_files = dedupe(profile.manifest_files);
  profile.entry_hints = dedupe(profile.entry_hints);
  if profile.languages.is_empty() && profile.manifest_files.iter().any(|f| f == "package.json") {
    profile.languages.push("javascript".to_string());
  }
  profile
}

/// Fixed-schema payload — all array keys always present (may be empty).
pub fn build_minimal_project_context_payload(
  project_root: &str,
  profile: &ProjectStackProfile,
  routes: &[MinimalProjectContextRoute],
) -> serde_json::Value {
  json!({
    "root": project_root,
    "languages": profile.languages,
    "runtimes": profile.runtimes,
    "frameworks": profile.frameworks,
    "capabilities": profile.capabilities,
    "entryHints": profile.entry_hints,
    "routes": routes,
  })
}

pub fn format_minimal_project_context_block(
  project_root: &str,
  profile: &ProjectStackProfile,
  routes: &[MinimalProjectContextRoute],
) -> String {
  let payload = build_minimal_project_context_payload(project_root, profile, routes);
  format!(
    "\n\n【项目上下文】manifest 检测的结构化事实；排查时依此栈自行选用符号与入口，勿凭记忆臆测。\n```json\n{}\n```",
    serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string())
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn fixed_schema_includes_empty_routes_array() {
    let profile = ProjectStackProfile {
      languages: vec!["typescript".into()],
      runtimes: vec!["node".into()],
      frameworks: vec!["vue3".into()],
      capabilities: vec![],
      manifest_files: vec!["package.json".into()],
      entry_hints: vec![],
    };
    let payload = build_minimal_project_context_payload("/tmp/demo", &profile, &[]);
    assert_eq!(payload["routes"], json!([]));
    assert!(payload.get("languages").is_some());
    assert!(payload.get("entryHints").is_some());
    let block = format_minimal_project_context_block("/tmp/demo", &profile, &[]);
    assert!(block.contains("\"routes\": []"));
  }

  /// Invoked from Vitest with PARITY_FIXTURE_ROOT + node-payload.json written by Node.
  #[test]
  fn parity_project_context_payload_from_env() {
    let Ok(root) = std::env::var("PARITY_FIXTURE_ROOT") else {
      panic!("PARITY_FIXTURE_ROOT must be set when running this test");
    };
    let node_payload_path = format!("{root}/node-payload.json");
    let expected_raw = std::fs::read_to_string(&node_payload_path)
      .unwrap_or_else(|e| panic!("read {node_payload_path}: {e}"));
    let expected: serde_json::Value = serde_json::from_str(&expected_raw)
      .unwrap_or_else(|e| panic!("parse node payload: {e}"));

    let profile = detect_project_stack_profile(&root);
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    let routes = rt.block_on(super::super::route_context::build_top_level_route_entries(
      &root, 12,
    ));
    let mut actual = build_minimal_project_context_payload(&root.replace('\\', "/"), &profile, &routes);
    if let Some(arr) = actual.get_mut("languages").and_then(|v| v.as_array_mut()) {
      arr.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }
    if let Some(arr) = actual.get_mut("runtimes").and_then(|v| v.as_array_mut()) {
      arr.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }
    if let Some(arr) = actual.get_mut("frameworks").and_then(|v| v.as_array_mut()) {
      arr.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }
    if let Some(arr) = actual.get_mut("capabilities").and_then(|v| v.as_array_mut()) {
      arr.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }
    if let Some(arr) = actual.get_mut("entryHints").and_then(|v| v.as_array_mut()) {
      arr.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
    }

    assert_eq!(actual, expected, "Rust payload must match Node node-payload.json");
  }
}
