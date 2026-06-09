<!--
@input:    本机依赖、npm 全局目录、PATH、~/.cc/ 配置
@output:   基础安装与首次启动的执行规则
@rule:     如本文件 @input 或 @output 发生变化，必须更新本注释
-->

# Install flow

## Base checks

Verify:

- Node.js >= 20
- tmux
- at least one supported AI CLI (claude / codex / gemini) logged in
- npm global prefix writable (if `/usr/local` lacks permission, set `npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to `$PATH`)

## Primary install path

```bash
npm i -g cc
cc onboard
```

Failure modes:

- Permission denied writing to npm prefix → configure `~/.npm-global` prefix as above, or use `sudo npm i -g cc`.
- Package not found (404) → cc hasn't been published to npm yet; fall back to source bootstrap below.
- Network / registry issues → check `npm config get registry` and proxy; retry.

## Source bootstrap fallback

Only if npm install fails because the package isn't published yet:

```bash
git clone https://github.com/JVever/cc.git
cd cc
bash install.sh            # npm install + npm run build + npm link
cc install-shell        # writes fn/fc/fl to ~/.zshrc
cc install-hook         # writes Claude SessionStart hook
cc onboard
```

## After install

- `cc doctor` should pass basic checks
- `cc onboard` guides the rest: IM setup, daemon, first session, auto-start, hardening

## Important rule

Do not stop at "install succeeded". The workflow must continue into channel setup and real validation.
