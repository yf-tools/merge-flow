# Team Setup & Installation Guide (MergeFlow)

This guide walks you through setting up **MergeFlow** on your machine in 5 minutes. MergeFlow automates reviewing, triaging, and resolving GitLab Merge Requests, discussions, and merge conflicts behind human approval gates.

---

## 1. Prerequisites Checklist

Verify that the following tools are available on your system:

| Tool | Minimum Version | Check Command | Installation |
| :--- | :---: | :--- | :--- |
| **Git** | Any modern version | `git --version` | Standard install / pre-installed |
| **Node.js** | `v18.0.0+` | `node -v` | [nodejs.org](https://nodejs.org/) |
| **GitLab CLI (`glab`)** | `v1.30+` | `glab --version` | `winget` (Win) / `brew` (Mac) / `apt` (Linux) |
| **Atlassian MCP** | — | Configured in IDE | See Step 3 below |

> [!NOTE]
> You do **not** need the GitLab MCP server. MergeFlow bundles high-performance GraphQL scripts that communicate directly via the official `glab` CLI with full repository context.

---

## 2. Authenticate GitLab CLI (`glab`)

MergeFlow uses `glab` to fetch MR details, discussions, diffs, and post thread replies.

1. Open your terminal and run:

   ```bash
   glab auth login
   ```

2. Follow the interactive prompts:
   - **GitLab instance:** Choose `gitlab.com` or enter your company's self-hosted domain (e.g. `gitlab.company.com`).
   - **Authentication method:** Select **Token**.
   - **Token:** Paste a GitLab Personal Access Token (create one in GitLab under *User Settings* → *Access Tokens* with scopes: `api`, `read_user`, `write_repository`).
3. Verify authentication:

   ```bash
   glab auth status
   ```

   *(You should see "Logged in to <host> as <your-username>" with green checkmarks).*

---

## 3. Configure Atlassian MCP (Jira)

MergeFlow reads and updates the associated Jira ticket status when resolving MRs via the official Atlassian Remote MCP server.

Add the `atlassian-mcp` definition to your IDE's MCP settings (e.g. Antigravity, Kiro, Cursor, or Claude Code `mcp.json`):

```json
{
  "mcpServers": {
    "atlassian-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.atlassian.com/v1/mcp",
        "--transport",
        "http-first"
      ]
    }
  }
}
```

> [!TIP]
> The first time this server runs, a browser window will open asking you to sign in to your Atlassian account and authorize access. No manual API tokens or passwords needed.
> 
> For official IDE setup guides across Cursor, VS Code, and others, refer to the [Official Atlassian MCP Documentation](https://support.atlassian.com/jira-software-cloud/docs/use-atlassian-mcp-server-with-an-ide/).

---

## 4. Install MergeFlow

### Option A: In Antigravity

Copy the `merge-flow` directory into your personal plugin configuration folder:

```text
~/.gemini/config/plugins/merge-flow
```

Or use the Plugins Manager UI in Antigravity to add the folder.

### Option B: In Kiro

In Kiro's Powers panel:

- Click **Add power from folder** (or clone the repository locally).
- Select the `merge-flow` directory.

### Option C: In Cursor / Windsurf / VS Code

Copy the `merge-flow` folder into your project root or your global AI prompt directory.

---

## 5. Built-in Preflight Diagnostic Script

Before running a real MR, test your machine's environment using the bundled preflight diagnostic:

```bash
node "<path-to-merge-flow>/preflight.mjs" --repo .
```

This verifies:

- ✅ Git installation & repository check
- ✅ Node.js runtime version
- ✅ `glab` CLI installation & authentication
- ✅ Network connectivity to GitLab & Jira

---

## 6. Verify with a Zero-Risk Dry Run

To test `mr-resolve` without touching any code or posting to GitLab:

```text
/mr-resolve <YOUR-MR-URL> --dry-run
```

### What you will see

1. The AI quietly fetches and triages all discussions on the MR and checks the Jira status.
2. It displays the clean **First Triage Report**.
3. It presents the interactive question modal asking if you want to proceed.
4. You make your selection (or type custom instructions in the write-in box).
5. It prints a **`[Dry-Run Summary]`** detailing the proposed plan and stops immediately without checking out branches, modifying code, or replying on GitLab.

If the dry run completes, your environment is 100% verified!
