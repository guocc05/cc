# cc Agent Instructions

This repository includes:
- a full onboarding workflow for installing, configuring, validating, and hardening cc on a user's machine (below);
- a maintainer release SOP at [`RELEASE.md`](./RELEASE.md) — **any AI assistant asked to "push" / "release" / "publish" cc must follow RELEASE.md step-by-step**, not improvise. Do not run `npm publish` without explicit maintainer authorization in the current conversation.

## When to use the onboarding workflow

Use the repo-local `cc-onboarding` skill when the user wants any of the following:

- install cc from scratch
- continue or repair an interrupted cc installation
- connect Feishu or WeChat to cc
- validate whether cc is truly usable on mobile
- enable cc auto-start on login

## Preferred execution model

Treat onboarding as a stateful workflow, not as a one-shot shell script.

Install cc via npm global:

```bash
npm i -g cc
cc onboard
```

- If `npm i -g cc` reports permission issues, help the user configure `npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to `$PATH`, then retry.
- If `npm i -g cc` returns 404 (package not yet published), fall back to source bootstrap:
  ```bash
  git clone https://github.com/JVever/cc.git && cd cc && bash install.sh
  cc install-shell && cc install-hook && cc onboard
  ```
- Do not rely on `gh auth login` or authenticated GitHub APIs.

You should:

1. detect the current install state (run `cc doctor` if already installed)
2. complete missing base installation steps
3. ask which IM channel the user wants to set up first: Feishu or WeChat
4. prefer completing one IM end-to-end before offering the second
5. if Feishu is chosen and no working bot exists, call `$create-feishu-bot`
6. write the returned credentials into `~/.cc/config.json`
7. start and validate the daemon
8. help the user create one real session and attach to it from mobile
9. after first success, continue with auto-start and basic security hardening (`cc secure`)

## Validation standard

Do not stop after `cc start`.

A successful onboarding requires:

- `cc doctor` passes basic checks
- the IM side responds to `/fhelp` or `/fl`
- the user creates one real session via `fn <name>` when already inside the project directory, or `fn <name> <path>` when not
- terminal convenience aliases `fn-codex` and `fn-gemini` are acceptable shortcuts on the computer side
- the user can see that session from IM and attach with `/fc <name>`

Only after this flow succeeds should onboarding move into post-success hardening.

Do not stop at first success if the user asked you to complete the setup. Continue until:

- auto-start is enabled or explicitly skipped by the user
- basic security hardening is completed or explicitly skipped by the user

## Feishu branch

If the user selects Feishu:

- first check whether `~/.cc/config.json` already has valid `appId` and `appSecret`
- if not, ask whether the user already has a reusable Feishu bot
- if not, use `$create-feishu-bot`
- prefer project inference using this repository to derive required permissions

## WeChat branch

If the user selects WeChat:

- verify the user has ClawBot enabled
- run `cc wechat login`
- wait for QR-based login completion

## User interruption policy

Minimize user interruptions. Only stop for:

- channel selection
- Feishu browser takeover permission
- Feishu login when no usable session exists
- WeChat QR scan
- final mobile-side validation commands
- auto-start opt-in
- security hardening confirmation
