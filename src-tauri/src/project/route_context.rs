use super::stack_profile::MinimalProjectContextRoute;
use std::path::{Path, PathBuf};

static ROUTE_BLOCK_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
  regex::Regex::new(r#"\{\s*path:\s*["']([^"']+)["'][\s\S]*?\}"#).unwrap()
});

static REDIRECT_ONLY_RE: std::sync::LazyLock<regex::Regex> =
  std::sync::LazyLock::new(|| regex::Regex::new(r"redirect\s*:").unwrap());

static COMPONENT_IMPORT_RE: std::sync::LazyLock<regex::Regex> =
  std::sync::LazyLock::new(|| {
    regex::Regex::new(
      r#"component:\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)"#,
    )
    .unwrap()
  });

static COMPONENT_IDENT_RE: std::sync::LazyLock<regex::Regex> =
  std::sync::LazyLock::new(|| regex::Regex::new(r"component:\s*([A-Za-z]\w*)\s*,?").unwrap());

static VUE_DESC_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
  regex::Regex::new(r#"(?is)<p[^>]*class="[^"]*\bdesc\b[^"]*"[^>]*>([\s\S]*?)</p>"#).unwrap()
});

struct TopLevelRouteEntry {
  path: String,
  component_ref: String,
}

pub fn extract_top_level_routes(router_source: &str) -> Vec<TopLevelRouteEntry> {
  let mut routes = Vec::new();
  let mut seen = std::collections::BTreeSet::new();
  for cap in ROUTE_BLOCK_RE.captures_iter(router_source) {
    let body = cap.get(0).map(|m| m.as_str()).unwrap_or("");
    let route_path = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
    if route_path.is_empty() {
      continue;
    }
    if REDIRECT_ONLY_RE.is_match(body) && !body.contains("component:") {
      continue;
    }
    let component_ref = COMPONENT_IMPORT_RE
      .captures(body)
      .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
      .or_else(|| {
        COMPONENT_IDENT_RE
          .captures(body)
          .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
      })
      .unwrap_or_default()
      .trim()
      .to_string();
    if component_ref.is_empty() || !seen.insert(route_path.to_string()) {
      continue;
    }
    routes.push(TopLevelRouteEntry {
      path: route_path.to_string(),
      component_ref,
    });
  }
  routes
}

fn strip_html_to_plain_text(html: &str) -> String {
  let no_tags = regex::Regex::new(r"<[^>]+>")
    .unwrap()
    .replace_all(html, " ");
  regex::Regex::new(r"\s+")
    .unwrap()
    .replace_all(no_tags.trim(), " ")
    .trim()
    .to_string()
}

pub fn extract_vue_page_description(vue_source: &str, max_len: usize) -> String {
  let Some(cap) = VUE_DESC_RE.captures(vue_source) else {
    return String::new();
  };
  let plain = strip_html_to_plain_text(cap.get(1).map(|m| m.as_str()).unwrap_or(""));
  if plain.chars().count() > max_len {
    format!(
      "{}…",
      plain.chars().take(max_len).collect::<String>()
    )
  } else {
    plain
  }
}

fn resolve_component_file_path(project_root: &Path, component_ref: &str) -> Option<PathBuf> {
  let normalized = component_ref.replace('\\', "/");
  let candidate = if normalized.contains('/') {
    let rel = if normalized.starts_with("src/") {
      normalized
    } else if normalized.starts_with("../") {
      format!("src/router/{normalized}")
    } else {
      format!("src/{normalized}")
    };
    let path = project_root.join(&rel);
    path.canonicalize().unwrap_or(path)
  } else {
    let candidates = [
      project_root.join("src/views").join(format!("{normalized}.vue")),
      project_root
        .join("src/components")
        .join(format!("{normalized}.vue")),
    ];
    candidates
      .into_iter()
      .find(|candidate| candidate.is_file())
      .map(|path| path.canonicalize().unwrap_or(path))
      .unwrap_or_else(|| project_root.join("src/views").join(format!("{normalized}.vue")))
  };
  candidate.is_file().then_some(candidate)
}

pub async fn build_top_level_route_entries(
  project_root: &str,
  max_routes: usize,
) -> Vec<MinimalProjectContextRoute> {
  let root = Path::new(project_root);
  let router_candidates = [
    root.join("src/router/index.ts"),
    root.join("src/router/index.js"),
    root.join("src/router.ts"),
  ];
  let mut router_source = String::new();
  for candidate in router_candidates {
    if let Ok(content) = tokio::fs::read_to_string(&candidate).await {
      if !content.trim().is_empty() {
        router_source = content;
        break;
      }
    }
  }
  if router_source.is_empty() {
    return Vec::new();
  }

  let routes: Vec<_> = extract_top_level_routes(&router_source)
    .into_iter()
    .filter(|r| r.path != "/" || !r.component_ref.is_empty())
    .take(max_routes)
    .collect();

  let mut entries = Vec::new();
  for route in routes {
    let desc = match resolve_component_file_path(root, &route.component_ref) {
      Some(path) => tokio::fs::read_to_string(path)
        .await
        .ok()
        .map(|content| {
          let slice: String = content.chars().take(4000).collect();
          extract_vue_page_description(&slice, 220)
        })
        .filter(|d| !d.is_empty()),
      None => None,
    };
    entries.push(MinimalProjectContextRoute {
      path: route.path,
      component: route.component_ref,
      desc,
    });
  }
  entries
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  #[test]
  fn extract_top_level_routes_skips_redirect_only() {
    let source = r#"
      { path: '/home', redirect: '/dashboard' },
      { path: '/dashboard', component: () => import('../views/Dashboard.vue') },
    "#;
    let routes = extract_top_level_routes(source);
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0].path, "/dashboard");
  }

  #[test]
  fn extract_vue_page_description_from_desc_class() {
    let vue = r#"<template><p class="desc">Hello <b>world</b></p></template>"#;
    assert_eq!(extract_vue_page_description(vue, 220), "Hello world");
  }

  #[test]
  fn build_top_level_route_entries_reads_router_and_vue_desc() {
    let root = std::env::temp_dir().join(format!(
      "aiall-route-{}",
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    fs::create_dir_all(root.join("src/router")).unwrap();
    fs::create_dir_all(root.join("src/views")).unwrap();
    fs::write(
      root.join("src/router/index.ts"),
      r#"{ path: '/foo', component: () => import('../views/FooView.vue') }"#,
    )
    .unwrap();
    fs::write(
      root.join("src/views/FooView.vue"),
      r#"<template><p class="desc">Foo page</p></template>"#,
    )
    .unwrap();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let entries = rt.block_on(build_top_level_route_entries(
      root.to_string_lossy().as_ref(),
      12,
    ));
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "/foo");
    assert_eq!(entries[0].component, "../views/FooView.vue");
    assert_eq!(entries[0].desc.as_deref(), Some("Foo page"));
    let _ = fs::remove_dir_all(&root);
  }
}
