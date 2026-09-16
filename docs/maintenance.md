# 维护与回滚

[文档首页](README.md) · [安装指南](installation.md) · [配置参考](configuration.md)

## 备份与重启

在空闲时备份实际使用的 OpenClaw 配置、插件安装目录和 `telegram-ux/` 状态目录。配置备份保留安装前的原生进度设置；升级备份保留上一版本的插件设置。备份目录权限建议为 700，配置文件为 600。

通过 OpenClaw 管理的服务可用 `openclaw gateway restart` 重启；其他部署沿用原有进程管理器。重启后用 `/tgux` 和一条普通消息检查结果。

## 状态文件

状态与偏好位于 OpenClaw 状态目录的 `telegram-ux/` 下，文件说明见[配置参考](configuration.md#保存内容)。升级保留偏好；启动时只收尾旧任务，不恢复旧任务或重发结果不确定的消息。

审计日志保存的是元数据，但仍含真实路由 ID。维护者需要公开证据时，可从源码仓库获取 `scripts/export-evidence.py`，在测试服务器上运行以生成代号化记录。原始配置、日志和服务器备份留在私有存储。

## 回滚到 0.1.0-beta.1

在空闲状态下使用**升级前的基线配置备份**，先恢复该插件自己的配置，再安装基线包。以下使用默认安装路径，备份路径需替换：

```sh
python3 ~/.openclaw/extensions/openclaw-telegram-ux/scripts/rollback.py \
  --backup /path/to/openclaw.json.before --restore-plugin-config
openclaw plugins install ./openclaw-telegram-ux-0.1.0-beta.1.tgz --force --accept-capabilities
openclaw plugins enable openclaw-telegram-ux
openclaw config validate
openclaw gateway restart
```

基线包从 [v0.1.0-beta.1 Release](https://github.com/pler1y/openclaw-telegram-ux/releases/tag/v0.1.0-beta.1) 获取，按该版本的校验文件核对。旧版 schema 不接受新增设置；回滚脚本负责恢复旧插件配置。基线忽略独立的偏好文件，无需删除历史记录。

## 禁用并恢复原生进度

使用安装前的配置备份，恢复目标账号的原生进度设置并禁用插件：

```sh
python3 ~/.openclaw/extensions/openclaw-telegram-ux/scripts/rollback.py \
  --backup /path/to/openclaw.json.before
openclaw gateway restart
```

脚本仅处理这个插件和目标账号的进度设置，保留当前模型、记忆、搜索、浏览器及其他插件配置。

## 卸载

先按上一节恢复原生进度，再卸载：

```sh
openclaw plugins uninstall openclaw-telegram-ux --force
openclaw gateway restart
```

宿主可能保留 `enabled: false` 标记，防止同 ID 自动重新发现。插件状态和审计文件保留在状态目录，可按需要归档。

## 检查服务

```sh
openclaw health --json
```

使用自定义 systemd 单元时，也可通过对应的 `systemctl --user is-active <service>` 查看服务状态。常见异常见[问题排查](troubleshooting.md)。
