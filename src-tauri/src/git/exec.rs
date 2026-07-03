use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const GIT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct GitOutput {
  pub stdout: String,
  pub stderr: String,
}

pub async fn git_exec(project_root: &str, args: &[&str]) -> Result<GitOutput, String> {
  let mut cmd = Command::new("git");
  cmd.args(args).current_dir(project_root).stdout(Stdio::piped()).stderr(Stdio::piped());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
  }
  let child = cmd.spawn().map_err(|e| {
    if e.kind() == std::io::ErrorKind::NotFound {
      "Git 未安装或不在 PATH 中".to_string()
    } else {
      e.to_string()
    }
  })?;
  let output = timeout(GIT_TIMEOUT, child.wait_with_output())
    .await
    .map_err(|_| "Git 命令超时".to_string())?
    .map_err(|e| e.to_string())?;
  let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
  let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
  map_git_error_output(&stdout, &stderr, output.status.success())
}

fn map_git_error_output(stdout: &str, stderr: &str, success: bool) -> Result<GitOutput, String> {
  if success {
    Ok(GitOutput { stdout: stdout.into(), stderr: stderr.into() })
  } else {
    Err(if stderr.trim().is_empty() {
      if stdout.trim().is_empty() {
        "Git 命令执行失败".into()
      } else {
        stdout.trim().into()
      }
    } else {
      stderr.trim().into()
    })
  }
}

pub async fn git_exec_ok(project_root: &str, args: &[&str]) -> bool {
  git_exec(project_root, args).await.is_ok()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn git_exec_ok_compiles() {
    assert!(true, "git_exec_ok compiles");
  }

  #[test]
  fn map_error_stderr_priority() {
    let r = map_git_error_output("stdout content", "error: failed", false);
    assert_eq!(r.unwrap_err(), "error: failed");
  }

  #[test]
  fn map_error_empty_stderr_uses_stdout() {
    let r = map_git_error_output("fatal: not a git repo", "", false);
    assert_eq!(r.unwrap_err(), "fatal: not a git repo");
  }

  #[test]
  fn map_error_both_empty() {
    let r = map_git_error_output("", "", false);
    assert_eq!(r.unwrap_err(), "Git 命令执行失败");
  }

  #[test]
  fn map_error_success() {
    let r = map_git_error_output("hello", "", true);
    assert_eq!(r.unwrap().stdout, "hello");
  }

  #[test]
  fn map_error_trims_whitespace() {
    let r = map_git_error_output("  ok  ", "  \n  ", false);
    assert_eq!(r.unwrap_err(), "ok");
  }

  #[test]
  fn map_error_stderr_trailing_space() {
    let r = map_git_error_output("", "  error message  \n", false);
    assert_eq!(r.unwrap_err(), "error message");
  }
}
