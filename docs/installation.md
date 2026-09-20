# 安装与升级

[文档首页](README.md) · [配置参考](configuration.md) · [维护与回滚](maintenance.md)

## 安装前确认

- OpenClaw 版本为 **2026.9.1**，Node.js **≥ 24.16.0**。
- Telegram 机器人已能通过 OpenClaw 正常回复，目标私聊已获得宿主授权。
- 在该私聊发送原生 `/whoami` 取得数字 ID，并确认机器人用户名。
- 等待当前任务结束后再安装和重启。

插件读取既有账号在运行时提供的 `botToken` 字符串。使用其他凭据来源时，先核对[凭据要求](configuration.md#凭据与权限)。

## 1. 备份现有配置

以下命令使用默认配置目录；自定义部署请替换为实际路径。

```sh
TGUX_BACKUP_DIR="$HOME/.openclaw/backups/telegram-ux-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TGUX_BACKUP_DIR"
chmod 700 "$TGUX_BACKUP_DIR"
cp "$HOME/.openclaw/openclaw.json" "$TGUX_BACKUP_DIR/openclaw.json.before"
chmod 600 "$TGUX_BACKUP_DIR/openclaw.json.before"
```

保留这份安装前配置，用于恢复原生进度设置。升级已有插件时，同时备份其安装目录和 `telegram-ux/` 状态目录。

## 2. 下载并校验

从 [v0.2.0-beta.1 Release](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.2.0-beta.2) 下载：

- `openclaw-telegram-ux-0.2.0-beta.2.tgz`
- `SHA256SUMS`

Linux 可在下载目录验证已下载文件：

```sh
sha256sum --ignore-missing --check SHA256SUMS
```

macOS 可运行以下命令，把结果与 `SHA256SUMS` 中安装包对应的一行比较：

```sh
shasum -a 256 openclaw-telegram-ux-0.2.0-beta.2.tgz
```

`Source code (zip/tar.gz)` 是源码快照；直接安装请使用单独上传的 `.tgz` 插件包。

## 3. 安装插件

```sh
openclaw plugins install npm-pack:./openclaw-telegram-ux-0.2.0-beta.2.tgz --accept-capabilities
```

首次安装会保留为待配置状态。接下来合并[默认账号示例](../examples/openclaw.default.json)或[命名账号示例](../examples/openclaw.named-account.json)，替换聊天 ID 和机器人用户名。示例是配置片段，保留现有模型、凭据和其他配置字段。

仅将目标 Telegram 账号的 `streaming.mode` 设置为 `off`，避免原生预览和插件进度同时出现。插件的私聊白名单不代替 OpenClaw 原有的授权规则。

## 4. 启用与重启

```sh
openclaw plugins enable openclaw-telegram-ux
openclaw config validate
openclaw gateway restart
```

这里的重启命令适用于由 OpenClaw 管理的服务；Docker、systemd 自定义单元或其他进程管理器沿用原有方式。参考[官方 Gateway 重启说明](https://docs.openclaw.ai/cli/gateway)。

## 5. 检查结果

在白名单私聊发送 `/tgux`，确认版本、启用状态和显示偏好。再发送一条普通消息，检查回执、最终答案与成功后的气泡清理。

```sh
openclaw health --json
```

出现问题时先看[问题排查](troubleshooting.md)。不支持的宿主版本会拒绝注册，不能通过单独放宽配置绕过兼容检查。

## 升级

阅读目标版本的更新日志并确认兼容性，按前述步骤备份、校验下载包，在空闲时带 `--force` 安装：

```sh
openclaw plugins install npm-pack:./openclaw-telegram-ux-0.2.0-beta.2.tgz --force --accept-capabilities
openclaw config validate
openclaw gateway restart
```

版本更换时使用对应的文件名。语言和显示偏好保存在独立状态文件中；重启不会恢复旧任务，只会收尾遗留状态。需要退回旧版时使用[回滚步骤](maintenance.md#回滚到-010-beta1)。
