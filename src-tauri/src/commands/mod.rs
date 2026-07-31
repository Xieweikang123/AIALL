pub mod agent;
pub mod ai;
pub mod automation;
pub mod chat;
pub mod dev_manage;
pub mod fs;
pub mod git;
pub mod project;
pub mod system;
pub mod watcher;
pub mod web;

#[cfg(test)]
mod tests {
    #[test]
    fn modules_compile() {
        assert!(true);
    }
}
