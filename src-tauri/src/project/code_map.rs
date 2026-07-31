use crate::fs::should_list_directory_entry;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_NODES: usize = 80;
const MAX_EDGES: usize = 120;
const MAX_DIR_DEPTH: usize = 3;
const MAX_IMPORT_EDGES: usize = 40;
const MAX_EXTERNAL_NODES: usize = 8;
const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeMapNode {
    id: String,
    kind: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    collapsed: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeMapEdge {
    id: String,
    source: String,
    target: String,
    kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeMapDocument {
    schema_version: u32,
    project_root: String,
    generated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    git_head: Option<String>,
    nodes: Vec<CodeMapNode>,
    edges: Vec<CodeMapEdge>,
    #[serde(skip_serializing_if = "Option::is_none")]
    focus_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated_count: Option<usize>,
}

fn normalize_rel(path: &str) -> String {
    path.replace('\\', "/").trim_matches('/').to_string()
}

fn module_id(rel: &str) -> String {
    if rel.is_empty() {
        "mod:.".to_string()
    } else {
        format!("mod:{}", normalize_rel(rel))
    }
}

fn entry_id(rel: &str) -> String {
    format!("entry:{}", normalize_rel(rel))
}

fn route_id(route_path: &str) -> String {
    format!("route:{}", route_path)
}

fn edge_id(kind: &str, source: &str, target: &str) -> String {
    format!("{kind}:{source}->{target}")
}

fn external_id(pkg: &str) -> String {
    format!("ext:{}", normalize_rel(pkg))
}

fn project_name(root: &Path) -> String {
    root.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string()
}

fn to_project_rel(root: &Path, abs: &Path) -> Option<String> {
    abs.strip_prefix(root)
        .ok()
        .map(|p| normalize_rel(&p.to_string_lossy()))
}

fn collect_entry_candidates(root: &Path, profile_hints: &[String]) -> Vec<String> {
    let mut out: BTreeSet<String> = BTreeSet::new();
    for hint in profile_hints {
        let rel = normalize_rel(hint);
        if root.join(&rel).is_file() {
            out.insert(rel);
        }
    }
    for candidate in [
        "src/main.ts",
        "src/main.js",
        "src/main.tsx",
        "src/main.jsx",
        "src/index.ts",
        "src/index.js",
        "src/App.vue",
        "src/App.tsx",
        "index.html",
        "src-tauri/src/main.rs",
        "src-tauri/src/lib.rs",
        "server/index.ts",
        "server/index.js",
        "Program.cs",
        "main.go",
        "main.py",
        "app.py",
    ] {
        if root.join(candidate).is_file() {
            out.insert(candidate.to_string());
        }
    }
    // package.json "main" / "module"
    if let Ok(raw) = std::fs::read_to_string(root.join("package.json")) {
        if let Ok(pkg) = serde_json::from_str::<Value>(&raw) {
            for key in ["main", "module", "browser"] {
                if let Some(p) = pkg.get(key).and_then(|v| v.as_str()) {
                    let rel = normalize_rel(p);
                    if !rel.is_empty() && root.join(&rel).is_file() {
                        out.insert(rel);
                    }
                }
            }
        }
    }
    out.into_iter().take(12).collect()
}

struct DirNode {
    name: String,
}

fn walk_modules(root: &Path, max_depth: usize) -> BTreeMap<String, DirNode> {
    let mut map: BTreeMap<String, DirNode> = BTreeMap::new();
    map.insert(
        String::new(),
        DirNode {
            name: project_name(root),
        },
    );

    fn walk(
        dir: &Path,
        rel: &str,
        depth: usize,
        max_depth: usize,
        map: &mut BTreeMap<String, DirNode>,
    ) {
        if depth >= max_depth {
            return;
        }
        let Ok(read) = std::fs::read_dir(dir) else {
            return;
        };
        let mut names: Vec<(String, PathBuf)> = Vec::new();
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !should_list_directory_entry(&name, is_dir) {
                continue;
            }
            // Modules are directories only (files appear as entry/route nodes).
            if !is_dir {
                continue;
            }
            // Skip nested .aiall internals as modules.
            if name == ".aiall" {
                continue;
            }
            names.push((name, entry.path()));
        }
        names.sort_by(|a, b| a.0.cmp(&b.0));
        for (name, path) in names {
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            map.entry(child_rel.clone()).or_insert(DirNode { name });
            walk(&path, &child_rel, depth + 1, max_depth, map);
        }
    }

    walk(root, "", 0, max_depth, &mut map);
    map
}

fn parent_module_id_for_file(rel: &str) -> String {
    let norm = normalize_rel(rel);
    if let Some(idx) = norm.rfind('/') {
        module_id(&norm[..idx])
    } else {
        module_id("")
    }
}

fn resolve_route_file(root: &Path, component_ref: &str) -> Option<String> {
    let normalized = component_ref.replace('\\', "/");
    let candidates: Vec<PathBuf> = if normalized.contains('/') {
        let rel = if normalized.starts_with("src/") {
            normalized.clone()
        } else if normalized.starts_with("../") {
            // common: from src/router → ../views/X.vue
            let trimmed = normalized.trim_start_matches("../");
            format!("src/{trimmed}")
        } else {
            format!("src/{normalized}")
        };
        vec![root.join(&rel)]
    } else {
        vec![
            root.join("src/views").join(format!("{normalized}.vue")),
            root.join("src/components")
                .join(format!("{normalized}.vue")),
        ]
    };
    for cand in candidates {
        if cand.is_file() {
            return to_project_rel(root, &cand);
        }
    }
    None
}

fn apply_size_gate(
    mut nodes: Vec<CodeMapNode>,
    mut edges: Vec<CodeMapEdge>,
) -> (Vec<CodeMapNode>, Vec<CodeMapEdge>, usize) {
    if nodes.len() <= MAX_NODES && edges.len() <= MAX_EDGES {
        return (nodes, edges, 0);
    }

    // Keep: root, depth-1 modules, all entry/route, and edges among kept.
    let mut keep: BTreeSet<String> = BTreeSet::new();
    for n in &nodes {
        match n.kind.as_str() {
            "root" | "entry" | "route" | "external" => {
                keep.insert(n.id.clone());
            }
            "module" => {
                let rel = n.path.as_deref().unwrap_or("");
                if !rel.contains('/') {
                    keep.insert(n.id.clone());
                }
            }
            _ => {}
        }
    }

    let before = nodes.len();
    nodes.retain(|n| keep.contains(&n.id));
    edges.retain(|e| keep.contains(&e.source) && keep.contains(&e.target));

    // If still over, drop trailing modules first.
    if nodes.len() > MAX_NODES {
        let mut module_ids: Vec<String> = nodes
            .iter()
            .filter(|n| n.kind == "module")
            .map(|n| n.id.clone())
            .collect();
        module_ids.sort();
        while nodes.len() > MAX_NODES {
            if let Some(drop_id) = module_ids.pop() {
                keep.remove(&drop_id);
                nodes.retain(|n| n.id != drop_id);
            } else {
                break;
            }
        }
        edges.retain(|e| keep.contains(&e.source) && keep.contains(&e.target));
    }

    if edges.len() > MAX_EDGES {
        edges.truncate(MAX_EDGES);
    }

    let truncated = before.saturating_sub(nodes.len());
    (nodes, edges, truncated)
}

fn add_cheap_depends(
    root: &Path,
    nodes: &mut Vec<CodeMapNode>,
    edges: &mut Vec<CodeMapEdge>,
    node_ids: &mut HashMap<String, ()>,
) {
    let pairs = [
        ("src", "server"),
        ("src", "src-tauri"),
        ("client", "server"),
    ];
    for (a, b) in pairs {
        if root.join(a).is_dir() && root.join(b).is_dir() {
            let sa = module_id(a);
            let sb = module_id(b);
            if node_ids.contains_key(&sa) && node_ids.contains_key(&sb) {
                let eid = edge_id("depends", &sa, &sb);
                if !edges.iter().any(|e| e.id == eid) {
                    edges.push(CodeMapEdge {
                        id: eid,
                        source: sa,
                        target: sb,
                        kind: "depends".into(),
                    });
                }
            }
        }
    }
    // package.json workspaces → external-ish labels under root
    if let Ok(raw) = std::fs::read_to_string(root.join("package.json")) {
        if let Ok(pkg) = serde_json::from_str::<Value>(&raw) {
            let mut workspaces: Vec<String> = Vec::new();
            if let Some(arr) = pkg.get("workspaces").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        let cleaned = s.trim_end_matches("/*").trim_matches('*').trim_matches('/');
                        if !cleaned.is_empty() && !cleaned.contains('*') {
                            workspaces.push(normalize_rel(cleaned));
                        }
                    }
                }
            } else if let Some(arr) = pkg
                .get("workspaces")
                .and_then(|v| v.get("packages"))
                .and_then(|v| v.as_array())
            {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        let cleaned = s.trim_end_matches("/*").trim_matches('*').trim_matches('/');
                        if !cleaned.is_empty() && !cleaned.contains('*') {
                            workspaces.push(normalize_rel(cleaned));
                        }
                    }
                }
            }
            for ws in workspaces.into_iter().take(6) {
                if !root.join(&ws).is_dir() {
                    continue;
                }
                let id = module_id(&ws);
                if node_ids.contains_key(&id) {
                    continue;
                }
                nodes.push(CodeMapNode {
                    id: id.clone(),
                    kind: "module".into(),
                    label: ws.clone(),
                    path: Some(ws),
                    summary: Some("workspace".into()),
                    collapsed: None,
                });
                node_ids.insert(id.clone(), ());
                let root_id = module_id("");
                edges.push(CodeMapEdge {
                    id: edge_id("contains", &root_id, &id),
                    source: root_id,
                    target: id,
                    kind: "contains".into(),
                });
            }
        }
    }
}

/// Extract import/require/from specifiers from JS/TS/Vue source (lightweight regex).
fn extract_import_specs(source: &str) -> Vec<String> {
    let mut out: BTreeSet<String> = BTreeSet::new();
    // from '…' / from "…"
    for cap in regex_lite_find_all(r#"(?:from|import)\s*['"]([^'"]+)['"]"#, source) {
        out.insert(cap);
    }
    // require('…') / import('…')
    for cap in regex_lite_find_all(r#"(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)"#, source) {
        out.insert(cap);
    }
    out.into_iter().collect()
}

/// Minimal capture helper: find all group-1 matches for a simple pattern with one ([^'"]+) group.
fn regex_lite_find_all(pattern_hint: &str, source: &str) -> Vec<String> {
    // Hand-rolled scanners to avoid pulling regex crate into this module's hot path deps.
    // pattern_hint is only for documentation of which scanner to use.
    let mut out = Vec::new();
    if pattern_hint.contains("require|import") {
        let needles = ["require(", "import("];
        for needle in needles {
            let mut rest = source;
            while let Some(idx) = rest.find(needle) {
                let after = &rest[idx + needle.len()..];
                let trimmed = after.trim_start();
                let quote = trimmed.chars().next();
                if quote == Some('\'') || quote == Some('"') {
                    let q = quote.unwrap();
                    if let Some(end) = trimmed[1..].find(q) {
                        let spec = &trimmed[1..1 + end];
                        if !spec.is_empty() {
                            out.push(spec.to_string());
                        }
                    }
                }
                rest = &rest[idx + needle.len()..];
            }
        }
    } else {
        // from '…' and import '…' (side-effect imports)
        for keyword in ["from ", "import "] {
            let mut rest = source;
            while let Some(idx) = rest.find(keyword) {
                let after = &rest[idx + keyword.len()..];
                let trimmed = after.trim_start();
                // skip `import type` / `import {` — only bare string side-effect or from-clause already matched
                let quote = trimmed.chars().next();
                if quote == Some('\'') || quote == Some('"') {
                    let q = quote.unwrap();
                    if let Some(end) = trimmed[1..].find(q) {
                        let spec = &trimmed[1..1 + end];
                        if !spec.is_empty() && !spec.starts_with('.') && keyword == "import " {
                            // bare package side-effect: keep
                            out.push(spec.to_string());
                        } else if !spec.is_empty() && keyword == "from " {
                            out.push(spec.to_string());
                        } else if !spec.is_empty() && spec.starts_with('.') {
                            out.push(spec.to_string());
                        }
                    }
                }
                rest = &rest[idx + keyword.len()..];
            }
        }
    }
    out
}

fn resolve_import_rel(from_file: &str, spec: &str) -> Option<String> {
    if !spec.starts_with('.') {
        return None;
    }
    let from_dir = match from_file.rfind('/') {
        Some(i) => &from_file[..i],
        None => "",
    };
    let mut parts: Vec<&str> = if from_dir.is_empty() {
        Vec::new()
    } else {
        from_dir.split('/').collect()
    };
    for seg in spec.split('/') {
        if seg == "." || seg.is_empty() {
            continue;
        }
        if seg == ".." {
            let _ = parts.pop();
            continue;
        }
        parts.push(seg);
    }
    Some(parts.join("/"))
}

fn strip_known_ext(rel: &str) -> String {
    for ext in [
        ".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs", ".json",
    ] {
        if let Some(stripped) = rel.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    rel.to_string()
}

fn resolve_existing_import_path(root: &Path, rel_no_ext_guess: &str) -> Option<String> {
    let candidates = [
        rel_no_ext_guess.to_string(),
        format!("{rel_no_ext_guess}.ts"),
        format!("{rel_no_ext_guess}.tsx"),
        format!("{rel_no_ext_guess}.js"),
        format!("{rel_no_ext_guess}.jsx"),
        format!("{rel_no_ext_guess}.vue"),
        format!("{rel_no_ext_guess}/index.ts"),
        format!("{rel_no_ext_guess}/index.js"),
        format!("{rel_no_ext_guess}/index.vue"),
    ];
    for cand in candidates {
        let norm = normalize_rel(&cand);
        if root.join(&norm).is_file() {
            return Some(norm);
        }
        if root.join(&norm).is_dir() {
            return Some(norm);
        }
    }
    None
}

fn package_name_from_spec(spec: &str) -> Option<String> {
    let s = spec.trim();
    if s.is_empty() || s.starts_with('.') || s.starts_with('/') {
        return None;
    }
    // skip URL / absolute aliases that look like paths
    if s.starts_with('@') {
        let mut parts = s.split('/');
        let scope = parts.next()?;
        let name = parts.next()?;
        return Some(format!("{scope}/{name}"));
    }
    Some(s.split('/').next()?.to_string())
}

fn best_target_for_rel(rel: &str, node_ids: &HashMap<String, ()>) -> Option<String> {
    let entry = entry_id(rel);
    if node_ids.contains_key(&entry) {
        return Some(entry);
    }
    // Walk up directories to find a module node.
    let mut cursor = normalize_rel(rel);
    if let Some(stripped) = strip_known_ext(&cursor).strip_suffix("/index") {
        cursor = stripped.to_string();
    } else {
        cursor = strip_known_ext(&cursor);
    }
    loop {
        let mid = module_id(&cursor);
        if node_ids.contains_key(&mid) {
            return Some(mid);
        }
        match cursor.rfind('/') {
            Some(i) => cursor = cursor[..i].to_string(),
            None => {
                if cursor.is_empty() {
                    break;
                }
                cursor.clear();
            }
        }
    }
    None
}

fn add_import_edges(
    root: &Path,
    nodes: &mut Vec<CodeMapNode>,
    edges: &mut Vec<CodeMapEdge>,
    node_ids: &mut HashMap<String, ()>,
) {
    let mut import_budget = MAX_IMPORT_EDGES;
    let mut external_budget = MAX_EXTERNAL_NODES;

    let scan_nodes: Vec<(String, String)> = nodes
        .iter()
        .filter(|n| n.kind == "entry" || n.kind == "route")
        .filter_map(|n| {
            let path = n.path.as_ref()?;
            if path == "." {
                return None;
            }
            Some((n.id.clone(), path.clone()))
        })
        .collect();

    for (source_id, file_rel) in scan_nodes {
        if import_budget == 0 {
            break;
        }
        let abs = root.join(&file_rel);
        let Ok(raw) = std::fs::read_to_string(&abs) else {
            continue;
        };
        // Vue SFCs: only scan script blocks roughly (still fine to scan whole file).
        let specs = extract_import_specs(&raw);
        for spec in specs {
            if import_budget == 0 {
                break;
            }
            let target_id = if let Some(rel) = resolve_import_rel(&file_rel, &spec) {
                let guessed = strip_known_ext(&rel);
                let resolved = resolve_existing_import_path(root, &guessed).unwrap_or(guessed);
                best_target_for_rel(&resolved, node_ids)
            } else if let Some(pkg) = package_name_from_spec(&spec) {
                let eid = external_id(&pkg);
                if !node_ids.contains_key(&eid) {
                    if external_budget == 0 {
                        continue;
                    }
                    nodes.push(CodeMapNode {
                        id: eid.clone(),
                        kind: "external".into(),
                        label: pkg.clone(),
                        path: None,
                        summary: Some("npm".into()),
                        collapsed: None,
                    });
                    node_ids.insert(eid.clone(), ());
                    external_budget -= 1;
                }
                Some(eid)
            } else {
                None
            };

            let Some(target_id) = target_id else {
                continue;
            };
            if target_id == source_id {
                continue;
            }
            if !node_ids.contains_key(&target_id) {
                continue;
            }
            let eid = edge_id("imports", &source_id, &target_id);
            if edges.iter().any(|e| e.id == eid) {
                continue;
            }
            edges.push(CodeMapEdge {
                id: eid,
                source: source_id.clone(),
                target: target_id,
                kind: "imports".into(),
            });
            import_budget -= 1;
        }
    }
}

pub async fn build_code_map(project_path: &str, git_head: Option<&str>) -> Value {
    let root = Path::new(project_path);
    if !root.is_dir() {
        return json!({ "ok": false, "error": "项目路径无效" });
    }

    let profile = super::detect_project_stack_profile(project_path);
    let routes = super::build_top_level_route_entries(project_path, 12).await;
    let modules = walk_modules(root, MAX_DIR_DEPTH);

    let mut nodes: Vec<CodeMapNode> = Vec::new();
    let mut edges: Vec<CodeMapEdge> = Vec::new();
    let mut node_ids: HashMap<String, ()> = HashMap::new();

    let root_id = module_id("");
    let mut root_label = project_name(root);
    if !profile.frameworks.is_empty() {
        root_label = format!("{} ({})", root_label, profile.frameworks.join(", "));
    }
    nodes.push(CodeMapNode {
        id: root_id.clone(),
        kind: "root".into(),
        label: root_label,
        path: Some(".".into()),
        summary: None,
        collapsed: None,
    });
    node_ids.insert(root_id.clone(), ());

    // Directory modules + contains edges
    for (rel, dir) in &modules {
        if rel.is_empty() {
            continue;
        }
        let id = module_id(rel);
        if node_ids.contains_key(&id) {
            continue;
        }
        nodes.push(CodeMapNode {
            id: id.clone(),
            kind: "module".into(),
            label: dir.name.clone(),
            path: Some(rel.clone()),
            summary: None,
            collapsed: None,
        });
        node_ids.insert(id.clone(), ());
    }
    for (rel, dir) in &modules {
        let parent_id = if rel.is_empty() {
            continue;
        } else if let Some(idx) = rel.rfind('/') {
            module_id(&rel[..idx])
        } else {
            root_id.clone()
        };
        let child_id = module_id(rel);
        if node_ids.contains_key(&parent_id) && node_ids.contains_key(&child_id) {
            edges.push(CodeMapEdge {
                id: edge_id("contains", &parent_id, &child_id),
                source: parent_id,
                target: child_id,
                kind: "contains".into(),
            });
        }
        let _ = &dir.name;
    }

    // Entries
    let mut focus_hint: Option<String> = None;
    for entry_rel in collect_entry_candidates(root, &profile.entry_hints) {
        let id = entry_id(&entry_rel);
        if node_ids.contains_key(&id) {
            continue;
        }
        let label = Path::new(&entry_rel)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&entry_rel)
            .to_string();
        nodes.push(CodeMapNode {
            id: id.clone(),
            kind: "entry".into(),
            label,
            path: Some(entry_rel.clone()),
            summary: None,
            collapsed: None,
        });
        node_ids.insert(id.clone(), ());
        let parent = parent_module_id_for_file(&entry_rel);
        let parent_id = if node_ids.contains_key(&parent) {
            parent
        } else {
            root_id.clone()
        };
        edges.push(CodeMapEdge {
            id: edge_id("contains", &parent_id, &id),
            source: parent_id,
            target: id.clone(),
            kind: "contains".into(),
        });
        if focus_hint.is_none() {
            focus_hint = Some(id);
        }
    }

    // Routes
    for route in &routes {
        let id = route_id(&route.path);
        if node_ids.contains_key(&id) {
            continue;
        }
        let file_path = resolve_route_file(root, &route.component);
        let label = if let Some(desc) = &route.desc {
            format!(
                "{} · {}",
                route.path,
                desc.chars().take(24).collect::<String>()
            )
        } else {
            route.path.clone()
        };
        nodes.push(CodeMapNode {
            id: id.clone(),
            kind: "route".into(),
            label,
            path: file_path.clone().or_else(|| {
                if route.component.contains('/') {
                    Some(normalize_rel(&route.component.trim_start_matches("../")))
                } else {
                    None
                }
            }),
            summary: route.desc.clone(),
            collapsed: None,
        });
        node_ids.insert(id.clone(), ());

        // Prefer attach under src/views or src/router module
        let parent = if let Some(ref fp) = file_path {
            parent_module_id_for_file(fp)
        } else {
            module_id("src")
        };
        let parent_id = if node_ids.contains_key(&parent) {
            parent
        } else {
            root_id.clone()
        };
        edges.push(CodeMapEdge {
            id: edge_id("routes_to", &parent_id, &id),
            source: parent_id,
            target: id,
            kind: "routes_to".into(),
        });
    }

    add_cheap_depends(root, &mut nodes, &mut edges, &mut node_ids);
    add_import_edges(root, &mut nodes, &mut edges, &mut node_ids);

    let (nodes, edges, truncated) = apply_size_gate(nodes, edges);
    let truncated_count = if truncated > 0 { Some(truncated) } else { None };

    let doc = CodeMapDocument {
        schema_version: SCHEMA_VERSION,
        project_root: project_path.replace('\\', "/"),
        generated_at: chrono::Utc::now().to_rfc3339(),
        git_head: git_head.map(|s| s.to_string()).filter(|s| !s.is_empty()),
        nodes,
        edges,
        focus_hint,
        truncated_count,
    };

    match serde_json::to_value(&doc) {
        Ok(document) => json!({ "ok": true, "document": document }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn build_code_map_includes_modules_and_entries() {
        let root = std::env::temp_dir().join(format!(
            "aiall-codemap-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("src/views")).unwrap();
        fs::create_dir_all(root.join("server")).unwrap();
        fs::create_dir_all(root.join("src/router")).unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"name":"demo","dependencies":{"vue":"^3.0.0"}}"#,
        )
        .unwrap();
        fs::write(
            root.join("src/main.ts"),
            "import { createApp } from 'vue'\nimport './App.vue'\n",
        )
        .unwrap();
        fs::write(
            root.join("src/router/index.ts"),
            r#"{ path: '/demo', component: () => import('../views/DemoView.vue') }"#,
        )
        .unwrap();
        fs::write(
      root.join("src/views/DemoView.vue"),
      r#"<script setup>import { ref } from 'vue'</script><template><p class="desc">Demo page</p></template>"#,
    )
    .unwrap();
        fs::write(root.join("src/App.vue"), "<template><div/></template>").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(build_code_map(
            root.to_string_lossy().as_ref(),
            Some("abc123"),
        ));
        assert_eq!(result["ok"], true);
        let doc = &result["document"];
        assert_eq!(doc["schemaVersion"], 1);
        let nodes = doc["nodes"].as_array().unwrap();
        assert!(nodes.iter().any(|n| n["kind"] == "root"));
        assert!(nodes
            .iter()
            .any(|n| n["kind"] == "module" && n["path"] == "src"));
        assert!(nodes.iter().any(|n| n["kind"] == "entry"));
        assert!(nodes.iter().any(|n| n["kind"] == "route"));
        assert!(nodes
            .iter()
            .any(|n| n["kind"] == "external" && n["label"] == "vue"));
        let edges = doc["edges"].as_array().unwrap();
        assert!(edges.iter().any(|e| e["kind"] == "imports"));
        let _ = fs::remove_dir_all(&root);
    }
}
