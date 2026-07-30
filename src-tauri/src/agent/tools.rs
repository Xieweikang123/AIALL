use serde_json::{json, Value};

pub fn agent_tool_definitions() -> Value {
  json!([
    {
      "type": "function",
      "function": {
        "name": "list_dir",
        "description": "列出目录下的文件和子目录。空 path 表示项目根；相对路径限于项目内；绝对路径可读本机任意目录。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "description": "目录路径：''=项目根，相对=项目内，绝对=本机任意目录" }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "读取文本文件。支持 offset/limit 按行读取大文件。建议一次读取 200-500 行连续代码。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "description": "文件路径：相对项目根，或本机绝对路径" },
            "offset": { "type": "number", "description": "起始行号，从 1 开始，默认 1" },
            "limit": { "type": "number", "description": "读取行数，默认 500，最大 800" }
          },
          "required": ["path"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "grep",
        "description": "在项目内搜索文本（正则或关键词）。",
        "parameters": {
          "type": "object",
          "properties": {
            "pattern": { "type": "string", "description": "搜索模式" },
            "max_matches": { "type": "number", "description": "最大匹配数，默认 40" }
          },
          "required": ["pattern"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "search_files",
        "description": "按文件名关键词搜索文件。",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "文件名关键词" },
            "max_results": { "type": "number", "description": "最大结果数，默认 30" }
          },
          "required": ["query"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "search_symbols",
        "description": "按符号名搜索项目内的函数、类、接口、类型等定义（比 grep 更适合找 API/组件名）。",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "符号名或片段" },
            "max_results": { "type": "number", "description": "最大结果数，默认 20" }
          },
          "required": ["query"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "write_file",
        "description": "写入或覆盖整个文件（Build 模式下立即落盘）。大文件优先用 patch_file。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "description": "相对项目根的文件路径" },
            "content": { "type": "string", "description": "完整文件内容" }
          },
          "required": ["path", "content"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "patch_file",
        "description": "对文件做精确局部替换（old_string 须在文件中唯一匹配）。适合大文件的小改动。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "description": "相对项目根的文件路径" },
            "old_string": { "type": "string", "description": "要被替换的原文（须精确匹配且唯一）" },
            "new_string": { "type": "string", "description": "替换后的内容" }
          },
          "required": ["path", "old_string", "new_string"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "delete_file",
        "description": "删除文件（Build 模式下立即执行）。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "description": "相对项目根的文件路径" }
          },
          "required": ["path"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "git_status",
        "description": "获取当前 Git 仓库工作区状态：分支、已暂存/未暂存/未跟踪文件列表。",
        "parameters": { "type": "object", "properties": {} }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "git_diff",
        "description": "查看 Git diff。可查看全部变更或单个文件。",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "description": "可选，相对项目根的文件路径" },
            "staged": { "type": "boolean", "description": "true=已暂存区，false=未暂存/工作区，默认 false" }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "run_command",
        "description": "在项目目录中执行 shell 命令。",
        "parameters": {
          "type": "object",
          "properties": {
            "command": { "type": "string", "description": "要执行的 shell 命令" },
            "timeout_ms": { "type": "number", "description": "超时时间（毫秒），默认 30000，最大 120000" }
          },
          "required": ["command"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "联网搜索，获取最新信息。",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string", "description": "搜索关键词" },
            "max_results": { "type": "number", "description": "最大结果数，默认 5，最大 10" }
          },
          "required": ["query"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "web_extract",
        "description": "抓取指定 URL 的网页内容，返回标题和正文。",
        "parameters": {
          "type": "object",
          "properties": {
            "url": { "type": "string", "description": "要抓取的网页 URL" },
            "mode": { "type": "string", "enum": ["auto", "html", "browser"], "description": "抓取模式，默认 auto" }
          },
          "required": ["url"]
        }
      }
    }
  ])
}

pub fn read_only_tool_names() -> Vec<&'static str> {
  vec![
    "list_dir", "read_file", "grep", "search_files", "search_symbols",
    "git_status", "git_diff", "web_search", "web_extract",
  ]
}

pub fn write_tool_names() -> Vec<&'static str> {
  vec!["write_file", "patch_file", "delete_file"]
}

pub fn is_write_tool(name: &str) -> bool {
  matches!(name, "write_file" | "patch_file" | "delete_file")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_tool_definitions_returns_12_tools() {
        let defs = agent_tool_definitions();
        let arr = defs.as_array().unwrap();
        assert_eq!(arr.len(), 13);
    }

    #[test]
    fn test_agent_tool_definitions_contains_all_tool_names() {
        let defs = agent_tool_definitions();
        let names: Vec<&str> = defs.as_array().unwrap().iter()
            .map(|v| v["function"]["name"].as_str().unwrap())
            .collect();
        for name in &["list_dir", "read_file", "grep", "search_files", "search_symbols", "write_file",
                       "patch_file", "delete_file", "git_status", "git_diff",
                       "run_command", "web_search", "web_extract"] {
            assert!(names.contains(name), "missing tool: {}", name);
        }
    }

    #[test]
    fn test_read_only_tool_names_returns_eight() {
        assert_eq!(read_only_tool_names().len(), 9);
    }

    #[test]
    fn test_read_only_tool_names_contains_expected() {
        let names = read_only_tool_names();
        for name in &["list_dir", "read_file", "grep", "search_files", "search_symbols",
                       "git_status", "git_diff", "web_search", "web_extract"] {
            assert!(names.contains(name));
        }
        assert!(!names.contains(&"write_file"));
    }

    #[test]
    fn test_write_tool_names_returns_three() {
        assert_eq!(write_tool_names().len(), 3);
    }

    #[test]
    fn test_write_tool_names_contains_expected() {
        let names = write_tool_names();
        assert!(names.contains(&"write_file"));
        assert!(names.contains(&"patch_file"));
        assert!(names.contains(&"delete_file"));
    }

    #[test]
    fn test_is_write_tool_positive() {
        assert!(is_write_tool("write_file"));
        assert!(is_write_tool("patch_file"));
        assert!(is_write_tool("delete_file"));
    }

    #[test]
    fn test_is_write_tool_negative() {
        assert!(!is_write_tool("read_file"));
        assert!(!is_write_tool("list_dir"));
        assert!(!is_write_tool("grep"));
        assert!(!is_write_tool("search_files"));
        assert!(!is_write_tool("git_status"));
        assert!(!is_write_tool("git_diff"));
        assert!(!is_write_tool("run_command"));
        assert!(!is_write_tool("web_search"));
        assert!(!is_write_tool("web_extract"));
        assert!(!is_write_tool(""));
        assert!(!is_write_tool("unknown"));
    }
}
