# start-web.bat 启动失败排障记录

## 问题现象

运行 `start-web.bat` 后提示：
> 当前为浏览器预览且未检测到 agent-server 后端：Agent / Git / 文件读写不可用。请运行 npm run dev 启动 Tauri，或在部署后访问服务端地址。

## 根本原因

**agent-server.exe 是旧版本**（2026/08/15 编译），缺少 `/api/server/ai-config` 等新增端点，前端探测返回 404，判定为"后端不可达"。

### 环境背景

- D:\ 盘有 Windows 不受信任的挂接点（reparse point）
- 直接用 `cargo build` 会报 `os error 448: 无法遍历该路径，因为它包含不受信任的装入点`
- 但通过 `cmd /c "cd /d D:\...\src-tauri && ..."` 从 D:\ 目录直接编译可以正常通过
- PowerShell 调用 `cmd` 时 cargo 也会失败（原因不明，可能与路径解析有关）

## 解决方案

### 重新编译 agent-server.exe

```cmd
cd /d D:\project\AIALL\src-tauri
C:\Users\57031\.cargo\bin\rustup.exe run stable cargo build --bin agent-server
```

编译成功后二进制自动覆盖到：
```
D:\project\AIALL\src-tauri\target\debug\agent-server.exe
```

### 重启服务

1. 杀掉旧进程：
```cmd
taskkill /F /IM agent-server.exe
```

2. 手动启动后端：
```cmd
start D:\project\AIALL\src-tauri\target\debug\agent-server.exe
```

3. 启动前端：
```cmd
npm run dev:web
```

4. 验证：
```cmd
curl http://127.0.0.1:8787/api/server/ai-config
# 应返回 {"endpoint":"","hasServerKey":false,"model":"","ok":true,"webProxyUrl":""}
```

## 预防措施

每次 Rust 源码有变更时，需手动重新编译 agent-server：
```cmd
cd /d D:\project\AIALL\src-tauri && C:\Users\57031\.cargo\bin\rustup.exe run stable cargo build --bin agent-server
```

## 相关命令速查

| 操作 | 命令 |
|------|------|
| 查看 agent-server 是否运行 | `Get-Process agent-server` |
| 杀掉 agent-server | `taskkill /F /IM agent-server.exe` |
| 编译 agent-server | `cd /d D:\project\AIALL\src-tauri && rustup run stable cargo build --bin agent-server` |
| 启动后端 | `start D:\project\AIALL\src-tauri\target\debug\agent-server.exe` |
| 启动前端 | `npm run dev:web` |
| 验证后端 | `curl http://127.0.0.1:8787/api/server/ai-config` |
