# codeg-server Management Script

`codeg.sh` 是 codeg-server 的管理脚本，提供启动、停止、重启和 Token 管理功能。

## 快速开始

```bash
# 设置静态 token（可选）
./codeg.sh set-token your-secret-token

# 启动服务（默认端口 3080）
./codeg.sh start

# 指定端口启动
CODEG_PORT=8080 ./codeg.sh start

# 查看状态
./codeg.sh status
```

## 命令

| 命令 | 说明 |
|------|------|
| `./codeg.sh start` | 启动服务器 |
| `./codeg.sh stop` | 彻底停止服务器（杀进程树） |
| `./codeg.sh restart` | 彻底重启（stop + start） |
| `./codeg.sh set-token <TOKEN>` | 设置静态认证 token |
| `./codeg.sh status` | 查看服务器状态 |
| `./codeg.sh token` | 查看当前 token |
| `./codeg.sh help` | 显示帮助 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CODEG_PORT` | 3080 | 服务器端口 |
| `CODEG_HOST` | 0.0.0.0 | 服务器地址 |
| `CODEG_TOKEN` | 自动生成 | 认证 token |
| `CODEG_DATA_DIR` | ~/.local/share/codeg | 数据目录 |
| `CODEG_STATIC_DIR` | - | 静态文件目录 |
| `CODG_PID_FILE` | ~/.codeg/codeg-server.pid | PID 文件路径 |
| `CODG_LOG_FILE` | ~/.codeg/codeg-server.log | 日志文件路径 |

## 示例

```bash
# 指定端口启动
CODEG_PORT=8080 ./codeg.sh start

# 设置静态 token（持久化到 ~/.codeg/.token）
./codeg.sh set-token my-secret-token

# 重启服务（应用新 token）
./codeg.sh restart

# 彻底停止
./codeg.sh stop
```

## 文件位置

- PID 文件：`~/.codeg/codeg-server.pid`
- 日志文件：`~/.codeg/codeg-server.log`
- Token 文件：`~/.codeg/.token`

## 前置条件

需要将 codeg-server 二进制链接到 `~/.local/bin/`：

```bash
ln -sf ~/code/codeg/src-tauri/target/release/codeg-server ~/.local/bin/codeg-server
```
