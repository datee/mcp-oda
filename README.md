<h1>
  <p align="center">
    <a href="https://github.com/gbbirkisson/mcp-oda">
      <img src="mcp.svg" alt="Logo" height="128">
    </a>
    <br>mcp-oda
  </p>
</h1>

<p align="center">
  A Model Context Protocol (MCP) server for interacting with <a href="https://oda.com">oda.com</a>
</p>

If this project is just what you needed and/or has been helpful to you, please consider buying
me a coffee ☕

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/gbbirkisson)

<h2>Table of contents</h2>

<!-- vim-markdown-toc GFM -->

* [Features](#features)
* [Installation](#installation)
* [Usage](#usage)
  * [Initial Setup](#initial-setup)
  * [CLI Commands](#cli-commands)
  * [Configuration](#configuration)
    * [Claude Desktop](#claude-desktop)
    * [Claude Code](#claude-code)
    * [Gemini CLI](#gemini-cli)
* [Troubleshooting](#troubleshooting)
  * [Session not persisting](#session-not-persisting)

<!-- vim-markdown-toc -->

## Features

This MCP server provides tools to programmatically interact with Oda's grocery shopping platform:

- **Search products** - Search for groceries with support for Norwegian terms
- **Browse recipes** - Search, filter, and view recipe details
- **Saved shopping lists** - Create and view lists, add/remove products,
  replace a product with a verified quantity, get view-only or editing sharing
  links, and import a whole list into the cart
- **Purchase history** - See your most frequently ordered products
- **Manage shopping cart** - View cart contents and recommendations, add/remove items or set
  exact quantities, add recipe ingredients
- **Delivery slots** - See upcoming delivery slots, prices and ordering deadlines (read-only)
- **CLI access** - All operations available as CLI subcommands in addition to MCP tools
- **Session persistence** - Maintains login session across restarts

## Installation

Use Node.js v22.12 or newer; the current Commander dependency requires it.

### Fork development

Development of additional saved-list tools is tracked in
[the development plan](docs/saved-list-development.md), with
[API research](docs/oda-list-api-research.txt) from Oda's website.
This branch implements list creation, verified product replacement and sharing links.
The original upstream installation commands below do not include these fork features.

Install dependencies with `npm ci --ignore-scripts`, then run `npm run build`.
The build supports Windows and Unix. Run `npm run lint` and `npm run test:unit`
for local checks. The unit test command excludes authenticated integration
tests, which can modify a real Oda cart.

After building this checkout, use the new CLI commands:

```sh
node dist/index.js saved-list create "Weekly meals" --confirmation "CREATE SAVED LIST"
node dist/index.js saved-list replace-product 123 456 789 --confirmation "UPDATE SAVED LIST"
# Override the replacement quantity instead of preserving the original count:
node dist/index.js saved-list replace-product 123 456 789 --quantity 2 --confirmation "UPDATE SAVED LIST"
```

Use the global `--data-dir <path>` option before `saved-list` to select an existing
local session directory. The corresponding MCP tools are `saved_list_create`
and `saved_list_replace_product`. Both require user authorization and a
confirmation argument; they affect saved lists only. Replacement rejects a target
already present in the list and source items with zero quantity. It reads the
list before and after the write, reporting `verified` or `uncertain`. Uncertain
results are MCP errors and CLI exit code 1; inspect the list before retrying.
Creation errors likewise require checking whether the list was created before
retrying, to avoid duplicates.

### Sharing a saved list

The `saved_list_get_share_link` MCP tool accepts `list_id` and an optional
`access` of `view` or `edit`. There is deliberately no default. Without `access`,
it returns `needs_access_choice` and asks: "Should the recipient only view the
list, or also be able to edit your original list?" This step makes no Oda request
and returns no URL. The assistant must relay the question and wait for the user.
If the user already explicitly specified the access level, it need not ask again.

With an explicit choice, the tool reads the existing link from Oda and returns
only that URL. It does not send the link to a recipient or modify the list.
Editing links are access keys to the original list, not independent copies.
Actual recipient editing, quantity preservation when saving a copy, and link
revocation have not been verified. Do not promise those behaviors.

The CLI requires an explicit access flag:

```sh
node dist/index.js saved-list share 123 --access view
node dist/index.js saved-list share 123 --access edit
```

Do not publish sharing URLs in logs or test fixtures. Only disclose a link when
the user requests sharing that specific list and has chosen its access level.

## Usage

### Initial Setup

Authenticate with your Oda account:

```bash
read -rsp "Oda password: " ODA_PASSWORD; printf '\n'
printf '%s' "$ODA_PASSWORD" | npx github:gbbirkisson/mcp-oda auth login --user your@email.com --pass-stdin
unset ODA_PASSWORD
```

Verify your login status:

```bash
npx github:gbbirkisson/mcp-oda auth user
```

> [!NOTE]
> Session data is stored by default in `~/.mcp-oda`

### CLI Commands

Running `npx github:gbbirkisson/mcp-oda` with no arguments prints help. The `mcp` subcommand
starts the MCP server. All other operations are available as subcommands:

```bash
# Start the MCP server
npx github:gbbirkisson/mcp-oda mcp

# Products
npx github:gbbirkisson/mcp-oda product search melk
npx github:gbbirkisson/mcp-oda product search melk --page 2
npx github:gbbirkisson/mcp-oda product add 132

# Saved shopping lists
npx github:gbbirkisson/mcp-oda saved-list list
npx github:gbbirkisson/mcp-oda saved-list details 123
# Adds a product to a saved list; requires an explicit confirmation string
npx github:gbbirkisson/mcp-oda saved-list add-product 123 456 --confirmation "UPDATE SAVED LIST"
# Removes a product from a saved list; requires an explicit confirmation string
npx github:gbbirkisson/mcp-oda saved-list remove-product 123 456 --confirmation "UPDATE SAVED LIST"
# Adds every list item to the cart; requires an explicit confirmation string
npx github:gbbirkisson/mcp-oda saved-list add 123 --confirmation "ADD SAVED LIST TO CART"

# Purchase history
npx github:gbbirkisson/mcp-oda purchases frequent
npx github:gbbirkisson/mcp-oda purchases frequent --limit 10 --max-orders 50

# Cart
npx github:gbbirkisson/mcp-oda cart list
npx github:gbbirkisson/mcp-oda cart recommendations --limit 10 --exclude-in-cart
npx github:gbbirkisson/mcp-oda cart remove 132
# Sets the total quantity of a product; 0 removes it
npx github:gbbirkisson/mcp-oda cart set 132 --count 3
# Clears the whole cart; requires an explicit confirmation string
npx github:gbbirkisson/mcp-oda cart clear --confirmation "CLEAR CART"

# Recipes
npx github:gbbirkisson/mcp-oda recipe search pizza
npx github:gbbirkisson/mcp-oda recipe details 123
npx github:gbbirkisson/mcp-oda recipe add 123 --portions 4
npx github:gbbirkisson/mcp-oda recipe remove 123

# Delivery slots and ordering deadlines (read-only)
npx github:gbbirkisson/mcp-oda delivery slots

# Authentication
read -rsp "Oda password: " ODA_PASSWORD; printf '\n'
printf '%s' "$ODA_PASSWORD" | npx github:gbbirkisson/mcp-oda auth login --user your@email.com --pass-stdin
unset ODA_PASSWORD
npx github:gbbirkisson/mcp-oda auth logout
npx github:gbbirkisson/mcp-oda auth user

# Maintenance
npx github:gbbirkisson/mcp-oda clean
```

### Configuration

#### Claude Desktop
Claude Desktop configuration example:

```json
{
  "mcpServers": {
    "oda": {
      "command": "npx",
      "args": ["-y", "github:gbbirkisson/mcp-oda", "mcp"]
    }
  }
}
```

#### Claude Code

```bash
/plugin marketplace add gbbirkisson/mcp-oda
/plugin install mcp-oda@mcp-oda
```

#### Gemini CLI

```bash
gemini extensions install https://github.com/gbbirkisson/mcp-oda
```

## Troubleshooting

### Session not persisting

If your login session is not persisting between runs:

1. Try running with the `clean` subcommand to remove old session data:
   ```bash
   npx github:gbbirkisson/mcp-oda clean
   ```
2. Re-authenticate:
   ```bash
   read -rsp "Oda password: " ODA_PASSWORD; printf '\n'
   printf '%s' "$ODA_PASSWORD" | npx github:gbbirkisson/mcp-oda auth login --user your@email.com --pass-stdin
   unset ODA_PASSWORD
   ```
3. Make sure you're using the same `--data-dir` for all commands if you've overridden the default.
