pub mod fs;
pub mod git;
pub mod chat;
pub mod project;
pub mod system;
pub mod ai;
pub mod web;
pub mod automation;
pub mod watcher;
pub mod agent;
pub mod dev_manage;

#[cfg(test)]
mod tests {
  #[test]
  fn modules_compile() {
    assert!(true);
  }
}
