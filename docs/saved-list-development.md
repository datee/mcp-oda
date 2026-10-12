# Saved-list extension development

This fork extends `gbbirkisson/mcp-oda`. The initial development branch is
`feat/saved-list-management`. The production installation remains separate
until the extension has been validated and deliberately deployed.

## Current status

This branch implements list creation and verified product replacement, alongside
the existing read, add/remove and import-to-cart tools. Standalone exact-quantity
updates and metadata updates remain planned. [API research](oda-list-api-research.txt) identifies the
website requests for these operations. These are private website endpoints,
so request shapes and behavior can change without notice.

The development baseline includes dependency lockfile security updates and
a portable build. It contains no account credentials or session files.

Baseline checks on Windows with Node.js 22.20.0 (12 October 2026): build and
lint passed; npm reported zero known vulnerabilities; unit tests passed 72
of 75 checks. The three existing Unix file-permission assertions failed as
described below. This was the baseline before implementing the extension.

## First implementation

1. Implemented: `saved_list_create(title, description?)`, returning the new list ID
   and title. Validate a nonempty title of at most 255 characters.
2. Implemented: `saved_list_replace_product(list_id, old_product_id, new_product_id,
   replacement_quantity?)`. Read the source quantity, send the website's
   removal/addition array in one request, then verify the affected products.
3. Planned: `saved_list_set_quantity(list_id, product_id, quantity)` using
   `overrideQuantity: true`. Preserve the website's distinction between zero
   quantity and deletion.
4. Planned: `saved_list_update_metadata(list_id, title?, description?)`, preserving
   fields not supplied by the caller.

Keep client methods, MCP tools and CLI commands consistent. Reuse existing
session/CSRF handling and correct list-page Referer headers. Add accurate MCP
write/destructive annotations and clear tool descriptions. Never expose
credentials or raw private responses in tool results.

## Verification

Use mocked API responses for request-shape, validation and failure tests.
Cover missing source products, identical source/target IDs, replacement
products already present, zero quantities and unavailable products. Reject
ambiguous replacement behavior until it is established.

A single request does not establish atomicity. On a timeout or partial
result, read the list and report the observed outcome before considering a
retry. Do not blindly retry list creation or product additions.

Live mutation testing requires an explicitly authorized disposable list.
Do not use the user's shopping lists or cart as fixtures.

On 12 October 2026, authorized live verification through a separate stdio MCP
process passed: 21 tools were advertised; a uniquely named disposable list was
created; a product at quantity 2 was replaced while preserving quantity 2;
the replacement was swapped back with an explicit quantity of 3. Both results
were verified by reading the list. The disposable list was deleted afterward
and its absence confirmed. No cart or order mutation was performed.

Extension checks: build and lint pass. All 42 new tests pass; the full offline
suite passes 114 of 117 tests, with only the same three baseline Windows
file-mode failures. The new commands are advertised by the CLI help.

The new mocked client and MCP protocol tests cover request shapes, validation,
required confirmation, write annotations, duplicate targets, partial results,
failed reads, lost write responses and avoiding retries. A lost creation response
requires the caller to check existing lists. Replacement automatically attempts
a read after its one write, including after HTTP errors or transport failure.
New mutations allow 20 seconds for the write and 10 seconds for each verifying
read, keeping replacement's three requests within a 40-second network budget.

This does not establish server-side atomicity or protection against simultaneous
edits by another client. A replacement already present in the list and a source
with zero quantity are rejected before writing. Unavailable-product errors are
handled as uncertain outcomes and are followed by a read; unavailable products
were not exercised live. The running installation has not been switched to this fork.

## Local commands

Use Node.js 22.12 or newer:

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm run test:unit
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.
The baseline unit suite has three assertions of Unix file mode `0600` that
fail on Windows. They do not validate Windows ACLs; account-session storage
needs a separate Windows permissions check. Do not remove that security
coverage just to make the suite green.

Do not run the full integration suite against an authenticated account as
part of ordinary development: it includes cart mutations. Keep session data
outside the checkout and never copy it into fixtures or commits.

## Later work

List deletion and copying are separate features. The copy endpoint's request
and response semantics remain unverified. Checkout and order placement are
outside this extension's scope.
