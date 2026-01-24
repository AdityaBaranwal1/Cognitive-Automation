# How to Share a Private Codebase

This guide explains how to create, manage, and share a private version of Pluely while maintaining the ability to sync with the upstream public repository.

---

## Table of Contents

1. [Creating a Private Fork](#creating-a-private-fork)
2. [Collaborating on Private Repositories](#collaborating-on-private-repositories)
3. [Managing Private Customizations](#managing-private-customizations)
4. [Syncing with Upstream](#syncing-with-upstream)
5. [Best Practices](#best-practices)
6. [Common Scenarios](#common-scenarios)

---

## Creating a Private Fork

GitHub doesn't allow direct private forks of public repositories. Here are three approaches to create a private version:

### Option 1: Mirror to a Private Repository (Recommended)

This method creates a complete mirror of the repository that can be kept private.

```bash
# 1. Create a new private repository on GitHub
# Go to: https://github.com/new
# Name it (e.g., "pluely-private") and select "Private"

# 2. Clone the public repository
git clone https://github.com/iamsrikanthnani/pluely.git pluely-private
cd pluely-private

# 3. Remove the original remote
git remote remove origin

# 4. Add your private repository as the new remote
git remote add origin https://github.com/YOUR_USERNAME/pluely-private.git

# 5. Push all branches and tags
git push -u origin main
git push --tags
```

### Option 2: Import via GitHub (Easiest)

GitHub provides a built-in import feature:

1. Go to: https://github.com/new/import
2. Enter the public repository URL: `https://github.com/iamsrikanthnani/pluely.git`
3. Choose your username and repository name
4. Select "Private"
5. Click "Begin import"

### Option 3: Duplicate with History

If you want to preserve the full git history:

```bash
# 1. Create a bare clone
git clone --bare https://github.com/iamsrikanthnani/pluely.git

# 2. Create your new private repository on GitHub

# 3. Mirror-push to the new repository
cd pluely.git
git push --mirror https://github.com/YOUR_USERNAME/pluely-private.git

# 4. Remove the temporary bare clone
cd ..
rm -rf pluely.git

# 5. Clone your private repository
git clone https://github.com/YOUR_USERNAME/pluely-private.git
cd pluely-private
```

---

## Collaborating on Private Repositories

### Adding Collaborators

1. Go to your private repository on GitHub
2. Navigate to **Settings** → **Collaborators and teams**
3. Click **Add people**
4. Enter GitHub usernames or emails
5. Choose permission level:
   - **Read**: View and clone only
   - **Write**: Push changes and manage issues
   - **Admin**: Full repository access

### Setting Up Team Access

For organizations:

1. Go to your organization on GitHub
2. Navigate to **Teams**
3. Create a new team or select existing one
4. Add team members
5. Grant team access to the private repository:
   - Go to repository **Settings** → **Collaborators and teams**
   - Add the team with appropriate permissions

### Collaboration Workflow

```bash
# Team member clones the private repository
git clone https://github.com/YOUR_USERNAME/pluely-private.git
cd pluely-private

# Create a feature branch
git checkout -b feature/my-feature

# Make changes and commit
git add .
git commit -m "Add my feature"

# Push to private repository
git push origin feature/my-feature

# Create a Pull Request on GitHub
# Other team members can review and merge
```

---

## Managing Private Customizations

### Strategy 1: Feature Branches

Keep your customizations in separate feature branches:

```bash
# Create a custom features branch
git checkout -b custom/enterprise-features

# Make your private customizations
# ... make changes ...

# Commit and push
git commit -am "Add enterprise features"
git push origin custom/enterprise-features

# Merge into main when ready
git checkout main
git merge custom/enterprise-features
```

### Strategy 2: Configuration-Based Approach

Keep customizations in configuration files that are gitignored:

```bash
# Add to .gitignore
echo "config.private.json" >> .gitignore
echo ".env.private" >> .gitignore

# Create your private configuration
cp config.example.json config.private.json
# Edit config.private.json with your private settings

# Your code loads config.private.json if it exists
# Falls back to default config if not
```

### Strategy 3: Plugin Architecture

Structure your customizations as plugins:

```bash
# Create a plugins directory
mkdir -p src/plugins/private

# Add to .gitignore
echo "src/plugins/private/*" >> .gitignore

# Create your private plugins
# These won't be tracked in git
```

---

## Syncing with Upstream

To receive updates from the public repository while maintaining your private version:

### Initial Setup

```bash
# Add the public repository as an upstream remote
git remote add upstream https://github.com/iamsrikanthnani/pluely.git

# Verify remotes
git remote -v
# Should show:
# origin    https://github.com/YOUR_USERNAME/pluely-private.git (fetch)
# origin    https://github.com/YOUR_USERNAME/pluely-private.git (push)
# upstream  https://github.com/iamsrikanthnani/pluely.git (fetch)
# upstream  https://github.com/iamsrikanthnani/pluely.git (push)
```

### Syncing Process

```bash
# 1. Fetch updates from upstream
git fetch upstream

# 2. Checkout your main branch
git checkout main

# 3. Merge upstream changes
git merge upstream/main

# 4. Resolve any conflicts if they occur
# Edit conflicted files, then:
git add .
git commit -m "Merge upstream changes"

# 5. Push to your private repository
git push origin main
```

### Automated Sync with GitHub Actions

Create `.github/workflows/sync-upstream.yml`:

```yaml
name: Sync with Upstream

on:
  schedule:
    # Run every day at midnight
    - cron: '0 0 * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Sync upstream changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git remote add upstream https://github.com/iamsrikanthnani/pluely.git
          git fetch upstream
          git merge upstream/main --no-edit
          git push origin main
```

### Selective Syncing

If you only want specific updates:

```bash
# Fetch upstream changes
git fetch upstream

# View available branches and tags
git branch -r
git tag -l

# Cherry-pick specific commits
git cherry-pick <commit-hash>

# Or merge specific tags/releases
git merge upstream/v1.2.3
```

---

## Best Practices

### 1. Keep Private and Public Changes Separate

```bash
# Use clear branch naming conventions
git checkout -b private/custom-auth    # Private features
git checkout -b public/bug-fix         # Could be contributed back
```

### 2. Document Your Changes

Create a `PRIVATE_CHANGES.md` file:

```markdown
# Private Customizations

## Custom Features
- Enterprise SSO integration (custom/sso-integration branch)
- Custom branding (custom/branding branch)

## Modified Files
- `src/auth/`: Added SAML support
- `src/config/`: Added enterprise config

## Dependencies Added
- `saml2-js`: For SSO authentication
```

### 3. Use Environment Variables for Secrets

Never commit sensitive data:

```bash
# Create .env.local (add to .gitignore)
PRIVATE_API_KEY=your-secret-key
CUSTOM_ENDPOINT=https://your-private-api.com

# Load in your code
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
```

### 4. Regular Syncing Schedule

```bash
# Create a sync reminder script
cat > scripts/check-upstream.sh << 'EOF'
#!/bin/bash
git fetch upstream
echo "Upstream commits since last sync:"
git log HEAD..upstream/main --oneline
EOF

chmod +x scripts/check-upstream.sh

# Add to crontab for weekly reminders
# crontab -e
# 0 9 * * MON cd /path/to/pluely-private && ./scripts/check-upstream.sh
```

### 5. License Compliance

Since Pluely is GPL v3:

- Your private modifications are allowed
- If you distribute the modified software, you must:
  - Include the source code
  - Use GPL v3 license
  - Document changes made
- Internal use without distribution doesn't require sharing

---

## Common Scenarios

### Scenario 1: Enterprise Deployment

**Goal**: Deploy privately with custom branding and SSO

```bash
# 1. Create private repository
# (Use Option 1 from "Creating a Private Fork")

# 2. Create customization branches
git checkout -b custom/enterprise-setup

# 3. Add enterprise features
# - Update branding in src/config/branding.ts
# - Add SSO in src/auth/sso.ts
# - Configure .env.production

# 4. Set up deployment
npm run tauri build

# 5. Deploy to internal servers
# Distribute the built application internally
```

### Scenario 2: Research Team Collaboration

**Goal**: Multiple researchers making private modifications

```bash
# 1. One person creates private repository

# 2. Add team members as collaborators

# 3. Each researcher works on feature branches
git checkout -b research/feature-extraction
git checkout -b research/custom-models

# 4. Use Pull Requests for code review
# Even in private repos, PRs are valuable for team review

# 5. Sync upstream periodically
git fetch upstream
git merge upstream/main
```

### Scenario 3: Custom Client Delivery

**Goal**: Deliver customized version to a client

```bash
# 1. Create client-specific branch
git checkout -b client/acme-corp

# 2. Apply client customizations
# - Custom UI theme
# - Client-specific integrations
# - Remove unused features

# 3. Create client-specific build
npm run tauri build -- --config src-tauri/tauri.acme.conf.json

# 4. Tag the release
git tag v1.0.0-acme
git push origin v1.0.0-acme

# 5. Deliver to client
# Provide built application + source code (GPL requirement)
```

### Scenario 4: Keeping Multiple Private Forks

**Goal**: Separate repositories for different use cases

```bash
# Create multiple private repositories
# 1. pluely-enterprise (for production)
# 2. pluely-experimental (for testing)

# In each repository:
git remote add upstream https://github.com/iamsrikanthnani/pluely.git

# Sync each independently
cd pluely-enterprise
git fetch upstream && git merge upstream/main

cd ../pluely-experimental
git fetch upstream && git merge upstream/main
```

---

## Sharing Built Applications

### Internal Distribution

```bash
# Build the application
npm run tauri build

# Built files location:
# - macOS: src-tauri/target/release/bundle/macos/
# - Windows: src-tauri/target/release/bundle/msi/
# - Linux: src-tauri/target/release/bundle/deb/

# Share via:
# - Internal file server
# - S3 bucket with restricted access
# - Internal package manager
```

### Code Sharing

```bash
# Create a tarball of source code
git archive --format=tar.gz --prefix=pluely-private/ HEAD > pluely-private.tar.gz

# Or create a zip
git archive --format=zip --prefix=pluely-private/ HEAD > pluely-private.zip

# Share the archive with team members
```

---

## Troubleshooting

### Problem: Merge Conflicts When Syncing

```bash
# If conflicts occur:
git fetch upstream
git merge upstream/main

# Manual resolution:
# 1. Open conflicted files
# 2. Look for markers: <<<<<<<, =======, >>>>>>>
# 3. Edit to resolve conflicts
# 4. Save files

git add .
git commit -m "Resolve merge conflicts from upstream"
git push origin main
```

### Problem: Accidentally Pushed Secrets

```bash
# Remove from history (DANGEROUS - rewrites history)
# Only do this if repository is truly private
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch path/to/secret-file" \
  --prune-empty --tag-name-filter cat -- --all

# Or use BFG Repo-Cleaner (easier)
# Download from: https://rtyley.github.io/bfg-repo-cleaner/
java -jar bfg.jar --delete-files secret-file.key

git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push origin --force --all
```

### Problem: Want to Contribute Back to Public Repository

```bash
# 1. Create a branch with only the public changes
git checkout -b public/contribution

# 2. Cherry-pick only relevant commits
git cherry-pick <commit-hash-1> <commit-hash-2>

# 3. Fork the public repository on GitHub

# 4. Add your fork as a remote
git remote add public-fork https://github.com/YOUR_USERNAME/pluely.git

# 5. Push to your public fork
git push public-fork public/contribution

# 6. Create a Pull Request to the original repository
# From: YOUR_USERNAME/pluely (public/contribution branch)
# To: iamsrikanthnani/pluely (main branch)
```

---

## Additional Resources

- [GitHub: Duplicating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/duplicating-a-repository)
- [Git: Working with Remotes](https://git-scm.com/book/en/v2/Git-Basics-Working-with-Remotes)
- [GPL v3 License FAQ](https://www.gnu.org/licenses/gpl-faq.html)
- [Tauri Building Documentation](https://tauri.app/v1/guides/building/)

---

## Questions?

If you have questions about sharing private codebases:

1. Check the [GitHub Discussions](https://github.com/iamsrikanthnani/pluely/discussions)
2. Review the [Pluely Documentation](https://github.com/iamsrikanthnani/pluely/wiki)
3. Contact support at [support@pluely.com](mailto:support@pluely.com)

---

**Note**: This guide is provided for legitimate use cases like enterprise deployments, research, and customization. Always respect the GPL v3 license terms and use this software responsibly.
