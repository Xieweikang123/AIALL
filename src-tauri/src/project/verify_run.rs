use crate::agent::runtime_hint;
use regex::Regex;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::process::Command;

static FAILING_FILE_RES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:FAIL|✓|×|✗)\s+([\w./\\-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s*>|\s|$)")
        .unwrap()
});
static FAILING_FILE_AT_RES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:at\s+)?(?:\./)?([\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?):\d+").unwrap()
});

const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MAX_OUTPUT_CHARS: usize = 32_000;

fn truncate_verify_output(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= MAX_OUTPUT_CHARS {
        return trimmed.to_string();
    }
    let half = MAX_OUTPUT_CHARS / 2;
    format!(
        "{}\n\n…[输出已截断]…\n\n{}",
        &trimmed[..half],
        &trimmed[trimmed.len().saturating_sub(half)..]
    )
}

fn extract_failing_files(stdout: &str, stderr: &str) -> Vec<String> {
    let combined = format!("{stdout}\n{stderr}");
    let mut files = std::collections::HashSet::new();
    for caps in FAILING_FILE_RES.captures_iter(&combined) {
        if let Some(m) = caps.get(1) {
            let file = m.as_str().replace('\\', "/").trim().to_string();
            if !file.is_empty() {
                files.insert(file);
            }
        }
    }
    for caps in FAILING_FILE_AT_RES.captures_iter(&combined) {
        if let Some(m) = caps.get(1) {
            let file = m.as_str().replace('\\', "/").trim().to_string();
            if !file.is_empty() {
                files.insert(file);
            }
        }
    }
    let mut out: Vec<String> = files.into_iter().collect();
    out.sort();
    out.truncate(16);
    out
}

fn append_section(existing: &str, heading: &str, body: &str) -> String {
    if body.trim().is_empty() {
        return existing.to_string();
    }
    let section = format!("=== {heading} ===\n{}", body.trim());
    if existing.is_empty() {
        section
    } else {
        format!("{existing}\n\n{section}")
    }
}

fn format_verify_command_label(commands: &[String]) -> String {
    commands.join(" → ")
}

async fn run_shell_command(
    project_path: &str,
    command: &str,
    timeout_ms: u64,
) -> (i32, String, String, bool) {
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", command]).current_dir(project_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    match tokio::time::timeout(Duration::from_millis(timeout_ms), cmd.output()).await {
        Ok(Ok(output)) => (
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
            false,
        ),
        Ok(Err(e)) => (-1, String::new(), e.to_string(), false),
        Err(_) => (-1, String::new(), "命令执行超时".into(), true),
    }
}

pub async fn project_verify_run(project_path: &str) -> Value {
    let root = Path::new(project_path);
    if !root.is_dir() {
        return json!({
          "ok": true,
          "skipped": true,
          "skipReason": "路径不存在或不是目录",
          "projectPath": project_path,
          "command": "",
          "exitCode": 0,
          "durationMs": 0,
          "stdout": "",
          "stderr": "",
          "failingFiles": [],
          "ranAt": chrono::Utc::now().to_rfc3339(),
          "verifyCommands": []
        });
    }

    let profile = runtime_hint::detect_project_runtime_profile(project_path).await;
    let verify_commands = profile.verify_scripts;
    let ran_at = chrono::Utc::now().to_rfc3339();

    if verify_commands.is_empty() {
        return json!({
          "ok": true,
          "skipped": true,
          "skipReason": "未检测到 package.json 中的 verify 脚本（typecheck/check/lint/test）",
          "projectPath": project_path,
          "command": "",
          "exitCode": 0,
          "durationMs": 0,
          "stdout": "",
          "stderr": "",
          "failingFiles": [],
          "ranAt": ran_at,
          "verifyCommands": []
        });
    }

    let started = Instant::now();
    let mut steps = Vec::new();
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut failing_files = std::collections::HashSet::new();
    let mut exit_code = 0;
    let mut timed_out = false;

    for command in &verify_commands {
        let step_started = Instant::now();
        let (code, out, err, step_timed_out) =
            run_shell_command(project_path, command, DEFAULT_TIMEOUT_MS).await;
        let step_stdout = truncate_verify_output(&out);
        let step_stderr = truncate_verify_output(&err);
        let step_ok = !step_timed_out && code == 0;
        let step_failing = if step_ok {
            Vec::new()
        } else {
            extract_failing_files(&step_stdout, &step_stderr)
        };
        for file in &step_failing {
            failing_files.insert(file.clone());
        }
        steps.push(json!({
          "command": command,
          "ok": step_ok,
          "exitCode": if step_timed_out { -1 } else { code },
          "durationMs": step_started.elapsed().as_millis(),
          "stdout": step_stdout,
          "stderr": step_stderr,
          "failingFiles": step_failing,
          "timedOut": step_timed_out
        }));
        stdout = append_section(&stdout, command, &step_stdout);
        stderr = append_section(&stderr, command, &step_stderr);

        if !step_ok {
            exit_code = if step_timed_out { -1 } else { code };
            timed_out = step_timed_out;
            break;
        }
    }

    let executed: Vec<String> = if steps.len() < verify_commands.len() {
        verify_commands.iter().take(steps.len()).cloned().collect()
    } else {
        verify_commands.clone()
    };
    let ok = exit_code == 0 && !timed_out;
    let failing_list: Vec<String> = failing_files.into_iter().collect();

    json!({
      "ok": ok,
      "projectPath": project_path,
      "command": format_verify_command_label(&executed),
      "exitCode": exit_code,
      "durationMs": started.elapsed().as_millis(),
      "stdout": stdout,
      "stderr": stderr,
      "failingFiles": failing_list,
      "ranAt": ran_at,
      "skipped": false,
      "timedOut": timed_out,
      "steps": steps,
      "verifyCommands": verify_commands
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_long_output() {
        let long = "x".repeat(40_000);
        assert!(truncate_verify_output(&long).len() < 40_000);
    }

    #[test]
    fn extract_failing_files_from_vitest_output() {
        let stdout = "FAIL src/foo.test.ts > case\n";
        let files = extract_failing_files(stdout, "");
        assert!(files.iter().any(|f| f.contains("src/foo.test.ts")));
        let with_stderr = extract_failing_files(stdout, "at src/foo.test.ts:12:3");
        assert!(with_stderr.iter().any(|f| f.contains("src/foo.test.ts")));
    }

    #[test]
    fn append_section_formats_heading() {
        let out = append_section("", "npm run test", "failed");
        assert!(out.contains("=== npm run test ==="));
    }
}
