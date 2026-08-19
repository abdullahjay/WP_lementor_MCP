# Elementor MCP Server — Implementation Guide

**Target:** WordPress plugin exposing an MCP server over the REST API
**Scope v1:** Elementor V3 (containers), Free + Pro widgets, Claude Code first then claude.ai
**Status:** Greenfield build plan

---

## 1. Decisions on record

| Decision | Choice | Reason |
|---|---|---|
| Where the server runs | WP plugin, MCP over REST | 80% of hard problems live inside Elementor's PHP runtime — widget registry, control schemas, CSS regeneration, the kit |
| Element model | V3 now, V4 behind an interface | V3 and V4 are different data models, not versions of one model |
| Widget coverage | Free + Pro | Costs nothing extra if the tool surface is registry-driven |
| Theme Builder | Deferred to v2 | Separate subsystem (`elementor_library` CPT + display conditions) |
| Transport | Plain JSON request/response | Streamable HTTP permits it when the server never initiates messages. Skipping SSE removes the worst part of running MCP in PHP |
| Auth | Phase A: Application Passwords. Phase B: OAuth 2.1 AS | Phase A unblocks all Elementor work; OAuth is a self-contained slice that can land last |
| Distribution | Undecided — build as if shippable | Capability checks, settings screen, no hardcoded paths, clean uninstall. Cheap now, expensive to retrofit |

**Not building in v1:** multi-tenant, licensing, Theme Builder, WooCommerce widgets, server→client notifications, V4 atomic.

---

## 2. Architecture

Five layers, strictly one-directional. Each layer may call downward only.

```
Transport      RestController — one route, JSON-RPC in/out. Knows nothing about MCP semantics.
    ↓
Protocol       JsonRpcHandler + method classes. Knows MCP. Knows nothing about Elementor.
    ↓
Registry       ToolRegistry — declarative Tool objects: name, schema, handler, capability, mutates flag.
    ↓
Safety         Validator → Snapshot → Ledger. Wraps every mutating handler.
    ↓
Domain         DocumentService, SchemaService, ContentService, MediaService, KitService.
               Plain PHP. No MCP awareness. Unit-testable.
```

**Why the domain layer must stay MCP-ignorant:** it's what lets you add WP-CLI commands, an admin UI, or a second transport later without touching business logic. It's also the only way the unit tests stay fast.

### Directory layout

```
emcp/
├── emcp.php                          Plugin header, guards, bootstrap
├── composer.json                     PSR-4: "EMCP\\" => "src/"
├── uninstall.php
├── src/
│   ├── Plugin.php                    Boot + wiring
│   ├── Transport/
│   │   ├── RestController.php
│   │   └── Cors.php
│   ├── Protocol/
│   │   ├── JsonRpcHandler.php
│   │   ├── JsonRpcException.php
│   │   └── Methods/
│   │       ├── Initialize.php
│   │       ├── ToolsList.php
│   │       ├── ToolsCall.php
│   │       ├── Ping.php
│   │       └── NoOp.php
│   ├── Registry/
│   │   ├── Tool.php
│   │   └── ToolRegistry.php
│   ├── Domain/
│   │   ├── DocumentService.php
│   │   ├── SchemaService.php
│   │   ├── ContentService.php
│   │   ├── MediaService.php
│   │   ├── KitService.php
│   │   └── Model/
│   │       ├── ElementModel.php      Interface
│   │       ├── V3Model.php
│   │       └── V4Model.php           Stub for now
│   ├── Safety/
│   │   ├── Validator.php
│   │   ├── Snapshot.php
│   │   ├── Ledger.php
│   │   ├── Capabilities.php
│   │   └── ToolException.php
│   ├── Tools/
│   │   ├── Discovery/
│   │   ├── Schema/
│   │   ├── Mutate/
│   │   └── Content/
│   └── Admin/SettingsPage.php
└── tests/
    ├── Unit/
    └── Fixtures/
```

---

## 3. Milestones

Build in this order. Each row is independently verifiable — do not start the next until the "Done when" holds.

| # | Deliverable | Done when |
|---|---|---|
| 0 | Skeleton, autoloader, settings screen, local env | Activates clean on WP 6.x + Elementor 3.x, zero notices with `WP_DEBUG` on |
| 1 | Transport + protocol + one trivial tool | MCP Inspector completes `initialize` → `tools/list` → `tools/call` |
| 2 | Auth phase A (Application Passwords) | Claude Code connects via `mcp-remote` and calls a tool |
| 3 | Read layer | A real page fully described in under ~4k tokens |
| 4 | Validation + snapshot + ledger | Malformed input rejected with a JSON path; every write reversible |
| 5 | Write layer | Round-trip: read → mutate → re-read matches expectation, CSS regenerated |
| 6 | `build_page` composite | Whole landing page from one declarative call |
| 7 | Auth phase B (OAuth 2.1 + DCR) | claude.ai adds it as a remote connector |

**Milestone 4 must precede 5.** Building writes before validation means every bug in 5 and 6 gets diagnosed against a corrupted database. This is the single most important sequencing rule in the plan.

---

## 4. Milestone 0 — Skeleton

`emcp.php` does four things and nothing else:

```php
<?php
/**
 * Plugin Name: Elementor MCP Server
 * Requires PHP: 8.1
 * Requires Plugins: elementor
 */

defined( 'ABSPATH' ) || exit;

if ( version_compare( PHP_VERSION, '8.1', '<' ) ) {
    add_action( 'admin_notices', fn() => printf(
        '<div class="notice notice-error"><p>%s</p></div>',
        esc_html__( 'Elementor MCP Server requires PHP 8.1+.', 'emcp' )
    ) );
    return;
}

require_once __DIR__ . '/vendor/autoload.php';

add_action( 'plugins_loaded', [ \EMCP\Plugin::class, 'boot' ], 20 );
```

**Priority 20 matters.** Elementor registers its widgets during `plugins_loaded`. Boot earlier and `widgets_manager` is empty when `SchemaService` tries to introspect it.

`Plugin::boot()` checks `did_action('elementor/loaded')`, instantiates the services, builds the registry, and hooks `rest_api_init`.

---

## 5. Milestone 1 — Transport and protocol

### 5.1 The route

```php
public function register_routes(): void {
    register_rest_route( 'emcp/v1', '/mcp', [
        [
            'methods'             => 'POST',
            'callback'            => [ $this, 'handle' ],
            'permission_callback' => [ Capabilities::class, 'can_use_mcp' ],
        ],
        [
            'methods'             => 'OPTIONS',
            'callback'            => [ Cors::class, 'preflight' ],
            'permission_callback' => '__return_true',
        ],
    ] );
}
```

`permission_callback` is **never** `__return_true` on the POST route. The OPTIONS preflight is the only exception, and it returns headers only.

### 5.2 The handler

```php
public function handle( \WP_REST_Request $request ) {
    try {
        $payload = json_decode( $request->get_body(), true, 64, JSON_THROW_ON_ERROR );
    } catch ( \JsonException ) {
        return $this->error_response( null, -32700, 'Parse error' );
    }

    try {
        $result = $this->dispatcher->dispatch( $payload );
    } catch ( JsonRpcException $e ) {
        return $this->error_response( $payload['id'] ?? null, $e->getCode(), $e->getMessage() );
    } catch ( \Throwable $e ) {
        // Never let a PHP fatal escape as HTML — it breaks the client's JSON parser
        error_log( '[EMCP] ' . $e->getMessage() );
        return $this->error_response( $payload['id'] ?? null, -32603, 'Internal error' );
    }

    if ( null === $result ) {          // notification — no response body
        return new \WP_REST_Response( null, 202 );
    }

    return new \WP_REST_Response( $result, 200 );
}
```

The catch-all `\Throwable` is not optional. A PHP warning rendered into the response body produces HTML in front of the JSON, and every MCP client fails with an opaque parse error that tells you nothing about the real problem.

### 5.3 CORS

```php
header( 'Access-Control-Allow-Origin: *' );
header( 'Access-Control-Allow-Methods: POST, OPTIONS' );
header( 'Access-Control-Allow-Headers: Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version' );
```

### 5.4 Method dispatch

```php
private const METHODS = [
    'initialize'                => Initialize::class,
    'notifications/initialized' => NoOp::class,
    'tools/list'                => ToolsList::class,
    'tools/call'                => ToolsCall::class,
    'ping'                      => Ping::class,
];

public function dispatch( array $payload ): ?array {
    $method = $payload['method'] ?? throw new JsonRpcException( 'Invalid request', -32600 );
    $id     = $payload['id'] ?? null;

    $class = self::METHODS[ $method ]
        ?? throw new JsonRpcException( "Method not found: {$method}", -32601 );

    $result = ( new $class( $this->registry ) )->run( $payload['params'] ?? [] );

    if ( null === $id ) {
        return null;   // notification: process, return nothing
    }

    return [ 'jsonrpc' => '2.0', 'id' => $id, 'result' => $result ];
}
```

A request with no `id` is a notification. Return nothing — not an empty result object. Clients that receive a response to a notification will log a protocol violation.

### 5.5 Initialize

```php
public function run( array $params ): array {
    return [
        'protocolVersion' => $params['protocolVersion'] ?? '2025-06-18',
        'capabilities'    => [ 'tools' => [ 'listChanged' => false ] ],
        'serverInfo'      => [
            'name'    => 'elementor-mcp',
            'version' => EMCP_VERSION,
        ],
    ];
}
```

### 5.6 Errors: the distinction that matters

| Situation | Response |
|---|---|
| Malformed JSON, unknown method, bad JSON-RPC envelope | JSON-RPC `error` object |
| Tool rejects bad input, post not found, validation failed | Successful result with `isError: true` |

A tool refusing bad input is a **normal successful response**. JSON-RPC errors mean the protocol itself broke. Clients treat these completely differently — conflating them means the model never sees your carefully written validation messages.

```php
// ToolsCall success shape
return [
    'content' => [ [ 'type' => 'text', 'text' => wp_json_encode( $result ) ] ],
    'isError' => false,
];
```

---

## 6. Tool registry

```php
final class Tool {
    public function __construct(
        public string   $name,
        public string   $description,
        public array    $inputSchema,
        public \Closure $handler,
        public string   $capability = 'edit_posts',
        public bool     $mutates    = false,
    ) {}
}
```

Registration, with a filter so the surface is extensible without forking:

```php
$registry->add( new Tool(
    name:        'get_page_structure',
    description: 'Returns a compact element tree for an Elementor page. '
               . 'Use max_depth to control size; drill in with get_element.',
    inputSchema: [
        'type'       => 'object',
        'properties' => [
            'post_id'   => [ 'type' => 'integer', 'description' => 'WordPress post/page ID.' ],
            'max_depth' => [ 'type' => 'integer', 'default' => 3, 'minimum' => 1, 'maximum' => 10 ],
        ],
        'required'             => [ 'post_id' ],
        'additionalProperties' => false,
    ],
    handler: fn( array $a ) => $documents->structure( $a['post_id'], $a['max_depth'] ?? 3 ),
) );

do_action( 'emcp_register_tools', $registry );
```

`additionalProperties: false` on every schema. It turns a silently ignored typo into an actionable error.

### v1 tool surface — 20 tools, not 110

| Group | Tools |
|---|---|
| Discovery | `list_pages`, `get_page_structure`, `get_element`, `find_element` |
| Schema | `list_widgets`, `describe_widget`, `get_container_schema`, `get_globals` |
| Mutate | `insert_element`, `update_element`, `move_element`, `remove_element`, `duplicate_element`, `batch_update`, `build_page` |
| Content | `create_post`, `update_post`, `list_media`, `upload_media` |
| Safety | `list_changes`, `rollback_change` |

**The key move is `describe_widget`.** Instead of encoding every widget's controls as a separate tool, introspect `get_controls()` at call time and return a curated schema. Elementor ships a new version with new controls — the server picks them up for free, and Pro widgets appear automatically because they're in the same registry. One-tool-per-widget does not scale past a few dozen widgets and burns the context window before the model has read a single page.

---

## 7. Milestone 2 — Auth phase A

Application Passwords already authenticate against the WP REST API over Basic auth, so the permission callback reduces to:

```php
public static function can_use_mcp(): bool {
    return is_user_logged_in() && current_user_can( 'edit_posts' );
}
```

Two known gotchas:

1. **HTTPS required.** Application Passwords are disabled over plain HTTP. On local dev either use a trusted cert or define `WP_ENVIRONMENT_TYPE` as `local`.
2. **Stripped `Authorization` header.** Some Apache/CGI configs drop it. If `$_SERVER['HTTP_AUTHORIZATION']` is empty, add to `.htaccess`:

```apache
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
```

Claude Code client config:

```json
{
  "mcpServers": {
    "elementor": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://site.test/wp-json/emcp/v1/mcp",
        "--header", "Authorization: Basic ${EMCP_AUTH}"
      ],
      "env": { "EMCP_AUTH": "base64(user:app-password)" }
    }
  }
}
```

---

## 8. Milestone 3 — Read layer

### 8.1 Model abstraction

This is where the V3/V4 decision earns its keep. V3 settings are flat key→value pairs. V4 atomic settings are typed prop objects, and styling lives in a global classes registry rather than inline on the element:

```jsonc
// V3
{ "settings": { "title": "Hello", "align": "center" } }

// V4 atomic
{ "settings": { "title": { "$$type": "string", "value": "Hello" } } }
```

Two different data models, not two versions of one. Keep the difference sealed behind an interface:

```php
interface ElementModel {
    public function digest( array $data, int $max_depth ): array;
    public function find( array $data, string $element_id ): ?array;
    public function normalize_settings( array $settings, string $widget_type ): array;
    public function merge_settings( array $existing, array $patch ): array;
}

public static function detect( array $data ): ElementModel {
    foreach ( $data as $node ) {
        if ( isset( $node['elType'] ) && 'e-flexbox' === $node['elType'] ) {
            return new V4Model();
        }
    }
    return new V3Model();
}
```

Everything above `DocumentService` speaks a normalized shape and never touches raw settings dicts. When V4 lands, you write `V4Model` and nothing else changes.

### 8.2 Reading the data

```php
public function structure( int $post_id, int $max_depth ): array {
    $raw = get_post_meta( $post_id, '_elementor_data', true );

    $data = is_string( $raw ) ? json_decode( $raw, true ) : $raw;

    if ( ! is_array( $data ) ) {
        throw new ToolException( "Post {$post_id} has no Elementor data. "
            . "Confirm the page was built with Elementor." );
    }

    return ElementModel::detect( $data )->digest( $data, $max_depth );
}
```

### 8.3 The digest — never return raw JSON

A real Elementor page is 50–200KB of JSON and will consume the entire context window in one call. `digest()` recurses emitting only:

```jsonc
{
  "id": "a1b2c3d",
  "elType": "container",
  "widgetType": null,
  "label": "Hero",
  "childCount": 3,
  "children": [ /* ... until max_depth, then: */ ]
}
// at depth limit:
{ "id": "f9e8d7c", "elType": "container", "truncated": 5 }
```

Label resolution, in order: `editor_settings.title` if the user named it in the Navigator, else the first text-bearing setting (`title`, `text`, `editor`, `heading`) stripped of HTML and truncated to ~40 chars, else the widget type. This is what makes the tree readable to a model without dumping settings.

`get_element` then returns full settings for one node by ID.

### 8.4 Schema introspection

```php
public function describe_widget( string $widget_type ): array {
    $widget = \Elementor\Plugin::$instance->widgets_manager->get_widget_types( $widget_type );

    if ( ! $widget ) {
        throw new ToolException( "Unknown widget type: {$widget_type}" );
    }

    $out = [];
    foreach ( $widget->get_controls() as $name => $control ) {
        if ( in_array( $control['type'] ?? '', [ 'section', 'tab', 'divider', 'heading' ], true ) ) {
            continue;   // layout-only controls, not settable values
        }
        $out[ $name ] = array_filter( [
            'type'    => $control['type']    ?? null,
            'label'   => $control['label']   ?? null,
            'default' => $control['default'] ?? null,
            'options' => $control['options'] ?? null,
        ] );
    }
    return [ 'widget' => $widget_type, 'title' => $widget->get_title(), 'controls' => $out ];
}
```

Filter aggressively. Raw `get_controls()` output on a Pro widget can exceed 1500 lines; the model needs settable values, not the editor's UI layout.

---

## 9. Milestone 4 — Safety ring

Every mutating handler passes through this, in order:

```
capability check
  → input schema validation
    → Elementor structural validation
      → pre-write snapshot
        → write via Document API
          → CSS invalidation
            → ledger entry
```

### 9.1 Structural validation

Validate every node before any write:

- `id` is a unique 7-character hex string across the whole document
- `elType` ∈ `{container, section, column, widget}`
- `widgetType` exists in `widgets_manager` (catches Pro widgets missing on the target site)
- every `settings` key exists in that widget's control set
- children are legal for the parent (`column` only inside `section`, etc.)

Reject with a precise JSON path:

```
Validation failed at elements[2].elements[0].settings.typography_font_size:
control not found on widget "heading". Did you mean "typography_font_size"
inside the "title_typography" group?
```

**Skipping this corrupts live pages, and the failure mode is a blank white page with no PHP error.** It is the worst class of bug in this system: silent, destructive, and hard to trace back to the call that caused it.

### 9.2 The Pro settings trap

Pro widgets store two sibling structures inside `settings`:

```jsonc
{
  "settings": {
    "title": "Fallback text",
    "__globals__": { "title_color": "globals/colors?id=primary" },
    "__dynamic__": { "title": "[elementor-tag id=\"x\" name=\"post-title\" ...]" }
  }
}
```

A naive partial update that merges into `settings` and rewrites `title` **silently strips the global colour or the dynamic tag**, and the page visibly changes. `merge_settings()` must merge at the correct depth and preserve `__globals__` and `__dynamic__` unless the caller explicitly clears them.

Add this as a regression fixture on day one. It is the bug most likely to reach production unnoticed.

### 9.3 The write path

Write through Elementor's Document API, not `update_post_meta`:

```php
$document = \Elementor\Plugin::$instance->documents->get( $post_id );
$document->save( [ 'elements' => $elements ] );
```

This handles three things you would otherwise have to reimplement:

1. **The slashing gotcha.** Direct meta writes need `wp_slash( wp_json_encode( $data ) )` — WordPress unslashes on save and mangles the JSON otherwise. This bites everyone once.
2. **CSS regeneration.** Elementor caches rendered CSS in `_elementor_css` postmeta and in `uploads/elementor/css/post-{id}.css`. Stale cache means your change is written to the database but invisible on the front end — which looks exactly like a failed write.
3. **Hooks.** Other plugins listen to Elementor's save actions.

Read directly from postmeta for speed; write through the API for correctness.

### 9.4 Snapshot and ledger

Before each write, store the prior `_elementor_data` plus metadata:

```php
$change_id = $this->ledger->record( [
    'post_id'   => $post_id,
    'tool'      => $tool_name,
    'args'      => $args,
    'before'    => $raw_before,
    'user_id'   => get_current_user_id(),
    'timestamp' => time(),
] );
```

Own table (`{$wpdb->prefix}emcp_changes`) rather than postmeta — you need indexed queries by post and by date, and postmeta bloat degrades autoload performance. Prune entries older than N days on a cron.

`rollback_change` restores `before` through the same Document API path, and records the rollback as its own ledger entry.

---

## 10. Milestones 5–6 — Write layer

Primitives first, composites second:

- `insert_element( post_id, parent_id, position, element )`
- `update_element( post_id, element_id, settings_patch )`
- `move_element( post_id, element_id, new_parent_id, position )`
- `remove_element( post_id, element_id )`
- `duplicate_element( post_id, element_id )`
- `batch_update( post_id, operations[] )` — all operations in **one** save

`build_page` is not a primitive. It's a chunked orchestration over `batch_update`, because a large page built in a single request will hit `max_execution_time` on shared hosting. Chunk by top-level container and save incrementally.

### Idempotency

A network hiccup mid-write must not duplicate a section. Accept an optional `idempotency_key` on mutating tools, store it on the ledger row, and return the prior result on a repeat key rather than re-executing.

---

## 11. Testing

Two harnesses, weighted toward the Elementor side — protocol bugs are rare and loud, Elementor bugs are frequent and silent.

### Unit tests with golden fixtures

Capture real `_elementor_data` blobs from actual pages into `tests/Fixtures/`:

| Fixture | Covers |
|---|---|
| `hero-container.json` | Modern flexbox container nesting |
| `legacy-section-column.json` | Pre-3.0 section/column structure still on live sites |
| `pro-globals-dynamic.json` | `__globals__` and `__dynamic__` preservation |
| `deep-nested.json` | Depth limiting and truncation |
| `empty-page.json` | Error path |

Each test runs mutate-and-compare: load fixture → apply operation → assert resulting tree. No WordPress bootstrap needed if the domain layer is genuinely MCP- and WP-ignorant, which keeps the suite fast enough to run on every save.

### Protocol conformance

```bash
npx @modelcontextprotocol/inspector
```

Point it at the endpoint with the auth header after every protocol change. Acceptance for Milestone 1:

- `initialize` returns your `serverInfo`
- `tools/list` shows the registered tools with valid JSON Schema
- `get_page_structure` against a real page returns under a few kilobytes

Once that round-trips, Milestones 3–6 are just adding entries to the registry. The hard infrastructure is done.

---

## 12. Risk register

| Risk | Mitigation |
|---|---|
| `max_execution_time` on large builds | `batch_update` is the primitive; `build_page` chunks over it and saves incrementally |
| Retried tool call duplicates content | Idempotency keys stored on the ledger |
| Privilege escalation via post ID | Every mutating tool re-checks `current_user_can( 'edit_post', $post_id )` — never trust the transport-level gate alone |
| Stale CSS makes writes look like failures | Always write through the Document API; assert CSS regeneration in round-trip tests |
| Pro widget missing on target site | `widgetType` existence check in the validator, with a clear error naming the missing widget |
| Elementor updates change control names | `describe_widget` introspects at call time — never hardcode control names in tool definitions |
| Context window exhaustion | Digest-not-raw on all reads; `max_depth` default 3; lazy schema fetch |
| PHP fatal returns HTML | Catch-all `\Throwable` in the REST handler mapping to `-32603` |

---

## 13. Deferred to v2

- **V4 atomic model** — implement `V4Model` against the existing interface
- **Theme Builder** — `elementor_library` CPT, template types, display conditions
- **OAuth 2.1 authorization server** — dynamic client registration (RFC 7591), protected resource metadata (RFC 9728), for claude.ai remote connector support
- **WooCommerce widgets**
- **Global classes / Class Manager** writes
- **Multi-site support**

---

## 14. Immediate next steps

1. Scaffold Milestone 0 and confirm clean activation with `WP_DEBUG` on
2. Build `RestController` + `JsonRpcHandler` + `get_site_info`
3. Verify with MCP Inspector before writing a single Elementor-aware line
4. Wire Application Passwords, connect from Claude Code
5. Capture the five golden fixtures from real pages — do this early, while you still have access to varied sites
6. Build the read layer against those fixtures

The discipline that matters most: **do not write a mutating tool until the validator and ledger are working.**
