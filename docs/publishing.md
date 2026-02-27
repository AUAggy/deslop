# Publishing the DeSlop Extension

## Why Publish to Both Registries

VS Code extensions are distributed through two separate registries that do not share listings:

**VS Code Marketplace** (marketplace.visualstudio.com) — Microsoft's official registry. Used by VS Code, VS Code Insiders, and GitHub Codespaces. Requires a Microsoft account and a publisher account.

**Open VSX Registry** (open-vsx.org) — The community-run, vendor-neutral alternative. Used by VSCodium, Eclipse Theia, Gitpod, and any editor that cannot use the Microsoft Marketplace due to licensing restrictions. Requires an Eclipse Foundation account.

Publishing to only one leaves a significant portion of users unable to install through their editor's built-in extension browser. VSCodium in particular has a growing developer user base that overlaps closely with this extension's target audience.

---

## Prerequisites

### VS Code Marketplace

1. Create a Microsoft account at https://account.microsoft.com if you don't have one.
2. Go to https://marketplace.visualstudio.com/manage and sign in.
3. Create a publisher — pick a publisher ID (e.g. `miaggy`). This becomes part of the extension's unique identifier: `miaggy.deslop`.
4. Create a Personal Access Token (PAT):
   - Go to https://dev.azure.com → User Settings → Personal Access Tokens
   - New token: name it `vsce`, set expiry, set **Marketplace → Manage** scope
   - Copy the token — it is shown only once
5. Install vsce if not already installed:
   ```bash
   npm install -g @vscode/vsce
   ```
6. Log in:
   ```bash
   vsce login miaggy
   # Paste your PAT when prompted
   ```

### Open VSX Registry

1. Create an Eclipse Foundation account at https://accounts.eclipse.org/user/register.
2. Go to https://open-vsx.org, sign in with your Eclipse account.
3. Generate an access token: https://open-vsx.org/user-settings/tokens
4. Install ovsx if not already installed:
   ```bash
   npm install -g ovsx
   ```

---

## Before Publishing: Update package.json

Update the `publisher` field in `package.json` from `humanizer-dev` to your actual publisher ID (e.g. `miaggy`). Also verify:

```json
{
  "publisher": "miaggy",
  "version": "0.1.0",
  "icon": "images/icon.png",
  "categories": ["Other"],
  "keywords": ["humanizer", "prose", "writing", "documentation", "ai"],
  "repository": {
    "type": "git",
    "url": "https://github.com/miaggy/vscode-humanizer"
  }
}
```

Note: The Marketplace requires a 128×128px PNG icon. Create `images/icon.png` before publishing. Without it, the listing will show a placeholder — not a blocker for publishing but looks unprofessional.

---

## Publishing Process

### Step 1: Compile and package

```bash
npm run compile
npx vsce package
```

This produces `humanizer-0.1.0.vsix`. Verify it is under 2MB:

```bash
ls -lh *.vsix
```

### Step 2: Publish to VS Code Marketplace

```bash
npx vsce publish
```

Or publish a pre-built `.vsix`:

```bash
npx vsce publish --packagePath humanizer-0.1.0.vsix
```

The extension will be live within a few minutes. Check it at:
`https://marketplace.visualstudio.com/items?itemName=miaggy.deslop`

### Step 3: Publish to Open VSX

```bash
npx ovsx publish humanizer-0.1.0.vsix -p <your-open-vsx-token>
```

The extension will be live within a few minutes. Check it at:
`https://open-vsx.org/extension/miaggy/humanizer`

---

## Updating an Existing Release

1. Bump the version in `package.json` following semver (patch for bug fixes, minor for new features):
   ```bash
   npm version patch   # 0.1.0 → 0.1.1
   # or
   npm version minor   # 0.1.0 → 0.2.0
   ```
2. Repackage: `npx vsce package`
3. Publish to both registries using the same commands above.
4. Tag the release in git:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

---

## Checklist Before Any Publish

- [ ] `npm run compile` exits 0 with no errors
- [ ] `npx vsce package` produces a clean `.vsix` with no errors
- [ ] `.vsix` is under 2MB
- [ ] `publisher` in `package.json` matches your actual publisher ID
- [ ] Version bumped from previous release
- [ ] `LICENSE` file present
- [ ] Marketplace listing preview checked at https://marketplace.visualstudio.com/manage
- [ ] Manual smoke test passed (see `docs/plans/2026-02-27-vscode-humanizer-v1.md` Task 13)
