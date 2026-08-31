# Elementor MCP — Blueprints

**Relationship to `solution.md`:** that document says *why*. This one says *what exactly* — the DSL grammar, the compiler contract, the normalized read shape, the plugin REST surface, the error taxonomy, and the fixture set. Where the two disagree, `solution.md` wins on intent and this document wins on shape.

**Consumers:** `prd.md` derives tasks from this. `ralphloop.md` points an agent at both.

**Verified against:** Elementor 4.3.0, MCP revision 2026-07-28, as of 20 Aug 2026.

**Status:** First cut. §11 lists what is deliberately unresolved.

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Spec** | A DSL document describing a page or a fragment |
| **Node** | One element in a spec |
| **Generation** | `legacy` \| `v3` \| `v4` — which Elementor data shape a node is stored in |
| **Native** | The Elementor JSON a spec compiles to |
| **Digest** | The normalized, depth-limited read shape (§5) |
| **Document hash** | Server-computed fingerprint used for compare-and-swap (§6.4) |
| **Working set** | The post IDs a session is permitted to mutate |

---

## 2. The DSL

### 2.1 Spec root

```jsonc
{
  "dslVersion": 1,
  "page": {
    "title": "Pricing",
    "template": "elementor_canvas",   // elementor_canvas | elementor_header_footer | elementor_theme | default
    "status": "draft"                  // draft only; publishing is a separate tool
  },
  "elements": [ /* nodes */ ]
}
```

`dslVersion` is mandatory and integer. The compiler refuses unknown versions rather than guessing — a spec authored against a later grammar must fail loudly, not partially apply.

### 2.2 Node shape

```jsonc
{
  "type": "container",
  "ref": "hero",                 // optional, spec-local stable handle (NOT an Elementor id)
  "label": "Hero",               // optional, becomes the Navigator title
  "layout":   { /* §2.4 */ },
  "style":    { /* §2.5 */ },
  "responsive": { "tablet": {}, "mobile": {}, "widescreen": {} },
  "children": [ /* nodes */ ],
  "raw":      { /* §2.8 */ },
  "reason":   "…"                // REQUIRED when `raw` is present or type is `html`
}
```

`ref` exists so a spec can be re-applied and diffed without knowing Elementor's generated IDs. It is spec-local, never written into Elementor, and is how `apply_page_spec` matches existing nodes on re-application.

### 2.3 Node types

Deliberately small and CSS/HTML-shaped, because every keyword that mirrors CSS is one the model already knows.

**Layout**

| `type` | Purpose |
|---|---|
| `container` | Flex layout. The default structural node |
| `grid` | Grid layout |

**Content**

| `type` | Fields |
|---|---|
| `heading` | `text`, `level` (1–6) |
| `text` | `html` (restricted inline markup) |
| `image` | `src` (media id or URL), `alt`, `link` |
| `button` | `text`, `link`, `icon` |
| `icon` | `name`, `link` |
| `list` | `items[]`, `ordered` |
| `video` | `src`, `poster`, `autoplay` |
| `divider` | — |
| `spacer` | `size` |

**Escape rungs** — these mirror P1's fallback ladder, and the DSL makes the ladder structural rather than advisory:

| `type` | Nativeness | Use when |
|---|---|---|
| `widget` | **Native** | Any registry widget the DSL doesn't model: `{ "type": "widget", "widgetType": "testimonial-carousel", "settings": { … } }` |
| `shortcode` | Native wrapper | A third-party plugin provides the capability |
| `html` | **Non-native** | Nothing above works. Requires `reason` |

**`widget` is the important one.** It reaches the entire installed registry — Free, Pro, third-party — at full nativeness, without the DSL modelling every widget. Most "the DSL can't express this" cases resolve here, not at `html`. `describe_widget` is its paired lookup tool.

### 2.4 Layout properties

```jsonc
"layout": {
  "direction": "row" | "column",
  "wrap": true,
  "justify": "start" | "center" | "end" | "between" | "around",
  "align": "start" | "center" | "end" | "stretch",
  "gap": 24,
  "padding": [80, 20],
  "margin": [0],
  "width": "full" | "boxed" | "1200px" | "50%",
  "minHeight": "100vh",
  "columns": 3            // grid only
}
```

### 2.5 Style properties

```jsonc
"style": {
  "color": "@primary",
  "background": { "color": "@surface", "image": 42, "position": "center", "size": "cover" },
  "border": { "width": 1, "color": "@border", "style": "solid" },
  "radius": 8,
  "shadow": "0 2px 8px rgba(0,0,0,.08)",
  "opacity": 0.9,
  "typography": {
    "size": "h1" | 32,
    "weight": 600,
    "lineHeight": 1.2,
    "letterSpacing": "-0.02em",
    "family": "@font/heading",
    "transform": "uppercase",
    "align": "center"
  }
}
```

### 2.6 Values and units

- Bare numbers are **px**.
- Strings carry their own unit: `"2rem"`, `"50%"`, `"auto"`, `"100vh"`.
- Box shorthands follow CSS: `[all]`, `[vertical, horizontal]`, `[top, right, bottom, left]`.
- Colors: hex, `rgb()`, or a **token reference**.

### 2.7 Token references

`@name` resolves against the site's design system. Built-in kit IDs: `@primary`, `@secondary`, `@text`, `@accent`. Custom kit colors resolve by their generated ID. Fonts use `@font/<id>`.

**Resolution is generation-dependent** and is the compiler's job:

| Generation | Emission |
|---|---|
| legacy / v3 | `__globals__: { "<control>": "globals/colors?id=primary" }` |
| v4 | A variable/global-class reference in the node's typed settings |

**An unresolvable token is an error, never a silent fallback to a literal.** Falling back produces a page that looks right and is disconnected from the design system — exactly the outcome P1 and P5 exist to prevent. The error names the token and lists what the site actually defines.

### 2.8 `raw` — supervised, not raw

`raw` merges into compiled settings under four constraints (P6):

1. **Deep merge**, never replace, so sibling structures survive.
2. **Reserved-key denylist:** `__globals__`, `__dynamic__`, `_element_id`, and anything the compiler owns. Setting a global or dynamic tag is done through dedicated DSL keys, not by hand.
3. **Value-level sanitisation** — see §8.3. Key-exists validation is not value validation.
4. **`reason` is mandatory**, and every use is counted into `raw_ratio` and written to the ledger as a reviewable event.

Emitting `raw` requires knowing native control names, which is what `describe_widget` is for. This is deliberate friction: `raw` is the rung below `widget`, not a shortcut past the grammar.

**Implemented (EMCP-053).** `server/src/dsl/raw.ts`'s `mergeRaw()`, wired in **centrally** by `compile.ts` after every emitter runs — never duplicated per-emitter, per-generation, since the mechanics don't vary by v3 vs v4, only where the merged result lands (`settings`, the one place every generation keeps its own per-node data; a v4 local-style `variants[].props` is deliberately out of scope — §2.8's own wording is "merges into compiled settings," not styles). Constraint 1 (deep merge): a real recursive merge, not `Object.assign` — nested objects merge key-by-key, only arrays and primitives replace outright; `raw` wins on a conflicting leaf, since it exists specifically to override or extend what the DSL alone produced. Constraint 2 (denylist): `__globals__`/`__dynamic__`/`_element_id` universally, checked recursively at every nesting level (a denylisted key three levels deep is exactly as dangerous as one at the top) — plus, v4-specific, `classes`, since `v4.ts`'s own emitters generate and depend on that exact key for local-style-class linkage; a `raw` block overwriting it would silently detach an element from styles the compiler just built for it. Constraint 3 (§8.3 sanitisation): every string value in the `raw` tree checked against all five rules.

**Every violation is a hard error, never a silent clean-and-continue** — §8.3's own words, taken literally: "it produces a legible error instead of silent stripping." A rejected `raw` block fails the *whole* compile (`elements: []`), the same all-or-nothing rule `dslVersion`/`parseSpec`/emitter failures already follow — a caller never has to wonder whether a partially-sanitised page is what actually got written. The one exception is the external-URL rule ("flag... for human review"), which is genuinely a warning in the spec's own words, not a rejection — it's applied but flagged, not blocked.

Constraint 4 (`reason` mandatory, `raw_ratio` reported) was already done — `REASON_REQUIRED` at the grammar layer (EMCP-048) and `rawRatio` computed over the whole tree (EMCP-049), both **before** this task existed and neither touched here. `rawRatio` counts a `raw` use whether or not it's ultimately rejected — the metric describes what the spec *attempted*, not just what compiled cleanly.

27 unit tests (`server/src/dsl/raw.test.ts`): `mergeRaw()` tested in isolation (deep merge, denylist at every nesting depth, all five sanitisation rules, the v3/v4 `classes` asymmetry), plus end-to-end `compile()` tests through the real v3/v4 emitters confirming the wiring — including one confirming a rejected `raw` block on one node fails the whole spec even with other valid nodes present.

### 2.9 Responsive

```jsonc
"responsive": {
  "widescreen": { "layout": { "padding": [120, 40] } },
  "tablet":     { "layout": { "direction": "column" } },
  "mobile":     { "style": { "typography": { "size": 28 } } }
}
```

Keys are breakpoint names **as configured on the target site**, read from `get_site_info`. Unknown breakpoint names are an error.

**`widescreen` is `min-width`; every other breakpoint is `max-width`.** The compiler inverts there. Getting this backwards lands overrides on the wrong side of the boundary and is close to invisible in review — it needs a dedicated fixture.

Responsive is part of the grammar from v1, not a later addition. Splitting it means re-authoring every fixture.

**Implemented (EMCP-052).** Breakpoint validation is one shared check both generations use — `compile.ts`'s exported `validateBreakpoint()`, checked against `siteProfile.breakpoints`'s real shape (confirmed live, `GET /site` on `wp-v4-pro`: `Record<name, { enabled, direction: 'min'|'max', value }>` — `desktop` is deliberately absent, since it's Elementor's implicit base case, never itself configurable, so `responsive: { desktop: {...} }` is correctly `BREAKPOINT_UNKNOWN` too). A real but currently **disabled** breakpoint (`laptop`/`mobile_extra`/`tablet_extra` on a fresh install) is treated the same as an unconfigured name — a disabled breakpoint has no live media query on the target site, so targeting one is just as wrong.

**The `min`-vs-`max` direction turned out not to be a data-shape concern for the compiler's *output* at all** — confirmed directly from `tests/fixtures/responsive-widescreen.json`'s own provenance note: "the raw `_elementor_data` here only names the breakpoint... does not itself say min-width vs max-width." Both generations treat every breakpoint, including `widescreen`, completely generically: v4 appends one more `{meta:{breakpoint,state:null},props,custom_css:null}` entry to the same flat `variants` array every other breakpoint uses (confirmed live: `widescreen`'s entry in the fixture has the exact same shape as `desktop`'s); v3 appends the same `_<breakpointName>` settings-key suffix mechanism `_tablet`/`_mobile` already used, so `_widescreen` needs no special-casing either. The direction inversion is entirely `Breakpoints_Manager`'s concern when Elementor's own CSS pipeline later reads this data — CLAUDE.md's gotcha is real, but it isn't this compiler's problem to solve.

**Scope matches EMCP-050/051's own limitation, not a new gap:** responsive is only wired for whatever `layout` properties each generation's desktop emission already maps (v3: `container` only; v4: every emitter, since they all route through `withLocalStyle()`). `responsive.<bp>.style` has no effect yet, for the same reason `style` itself is deferred at desktop in both generations.

13 new unit tests (`server/src/dsl/responsive.test.ts`), including one asserting the widescreen variant's exact shape against `responsive-widescreen.json`'s real captured structure, and one confirming the same invalid breakpoint is refused identically on both generations.

---

## 3. Compiler contract

**Grammar and schema implemented (EMCP-048) — §2, ahead of the compiler itself.** `server/src/dsl/types.ts` (pure TypeScript types for the grammar) and `server/src/dsl/validate.ts` (`parseSpec(input: unknown): { spec: Spec | null; diagnostics: Diagnostic[] }`) are the real, tested implementation of §2 — `dslVersion` enforced (missing/non-integer/unsupported all refused, never guessed at, matching §2.1's "must fail loudly, not partially apply"), every node type checked against §2.3's real set, every type's required fields checked per §2.3's table, and §2.8's "`reason` is mandatory whenever `raw` is present or the node is `html`" enforced in one place. **Deliberately hand-rolled TypeScript, not Zod** — despite §11.2's stack table naming Zod for validation, every tool schema and `domain/validate.ts` (EMCP-036) already established hand-written JSON Schema plus manual type-narrowing as this codebase's real practice before this task existed; introducing Zod here would add a second validation idiom for no benefit this module needed, so consistency won. Reuses `domain/validate.ts`'s exact `Diagnostic` shape — one vocabulary for every diagnostic this project ever produces, grammar-layer or compiler-layer.

**Explicit scope boundary, drawn on purpose:** this layer validates only what's true of a spec *on its own* — independent of any site. Everything requiring `siteProfile` (§3.1) — does this widget exist, is this breakpoint real, does this `@token` resolve — is left to the compiler (EMCP-049+), not checked here even though `layout`/`style`/`responsive` are accepted as well-formed plain objects at this layer. That split is §3's own: `compile(spec, siteProfile)` is where site-dependent semantics live. 36 unit tests (`server/src/dsl/validate.test.ts`) cover: a minimal and a fully-populated valid spec (nested children, layout/style/responsive, every optional page field), every unsupported-`dslVersion` shape, every node type's required-field-missing case, the `reason`-required rule for both `raw` and `html`, recursive children with a full nested diagnostic path, and the no-partial-application guarantee (one invalid node anywhere fails the whole spec, not just that node).

### 3.1 Signature

```
compile(spec, siteProfile) → { elements, diagnostics, nativeness, rawRatio }
```

`siteProfile` comes from `get_site_info` and carries: generation to emit, breakpoints, kit tokens, registered widget list, Pro tier, active experiments.

The compiler is **pure and synchronous** — no network. Everything it needs about the site arrives in `siteProfile`, which is what makes it unit-testable against fixtures (§9).

### 3.2 Emission by generation

| DSL | v3 | v4 |
|---|---|---|
| `container` | `elType: container` | `elType: e-flexbox` |
| `grid` | `elType: container` + grid settings | `elType: e-grid` |
| `heading` | `widget` / `widgetType: heading` | `widget` / `widgetType: e-heading` |
| `text` | `widgetType: text-editor` | `widgetType: e-paragraph` |
| `image` | `widgetType: image` | `widgetType: e-image` |
| `button` | `widgetType: button` | `widgetType: e-button` |
| `widget` | passthrough `widgetType` | passthrough `widgetType` |

**Settings shape differs fundamentally, not cosmetically:**

- **v3:** flat `key → value`, responsive via `_tablet` / `_mobile` key suffixes, styling inline in `settings`.
- **v4:** typed props, **which nest** — a heading title is `{"$$type":"html-v3","value":{"content":{"$$type":"string","value":"…"},"children":[]}}`, not a flat scalar. Styling goes in the node's local `styles` array with responsive and pseudo-state variants. Nodes carry `version`.
- **Empty is `[]`, not `{}`.** An element or widget with no customized `settings`, `styles`, `interactions`, or `editor_settings` yet serializes those fields as an empty array — JSON `[]`, not `{}`. PHP's array-vs-associative-array-to-JSON behavior leaking through. A parser that assumes these fields are always objects (e.g. `Object.keys(node.settings)`) throws or misbehaves on any freshly-inserted, uncustomized element — which is the common case for a widget just dragged in, not an edge case. Confirmed live (EMCP-008, `v4-atomic` fixture) on a freshly-placed `e-heading`/`e-button` before any content or styling was set.

A compiler that assumes flat `{$$type, value}` scalars drops content silently. This is the single most likely v4 bug and gets its own fixture.

**v3 column implemented (EMCP-050).** `server/src/dsl/v3.ts` registers real `compile.ts` emitters for `container`, `heading`, `text`, `button`, `icon`, `image`, `spacer`, `divider`, `shortcode`, `html` — every setting key and value shape confirmed against **live-introspected control names** (`GET /widgets/{type}`, EMCP-028, against `wp-v4-pro`) and the committed fixtures (`tests/fixtures/v3-container.json`/`deep-nested.json`, hash-checked and agent-immutable), never guessed from convention. Real, confirmed value-shape helpers: `toSize()` (Elementor's SLIDER control — `{ unit, size, sizes: [] }`, cross-checked against `mixed-legacy-v3.json`'s captured `typography_font_size`), `toDimensions()` (the DIMENSIONS control — 4-sided `{ unit, top, right, bottom, left, isLinked }`, §2.6's box-shorthand expanded), `toGaps()` (the GAPS control), `toLinkControl()` (the URL control's real `{ url, is_external, nofollow, custom_attributes }` shape). `container`'s `isInner` (`false` top-level, `true` nested — confirmed via `deep-nested.json`) is derived from tree depth, since `compile.ts` itself doesn't track it.

**Deliberately deferred, not guessed, each for a specific reason (see `v3.ts`'s own closing docblock for the full reasoning):** `grid` (its real control names live on the non-widget `container` elType, not introspectable via `GET /widgets/{type}` the way every widget above was); `list` (the real "Icon List" widget is a per-item-icon REPEATER control, not a plain text list — no confirmed mapping from the DSL's flat `items: string[]`); `video` (the real widget needs one of six type-specific URL keys selected by `video_type`, requiring URL-pattern detection this task didn't build). All three still report `EMISSION_NOT_IMPLEMENTED` on v3, correctly.

**Two fields with no confirmed v3 mapping, surfaced as warnings rather than silently dropped or hard-failed:** `layout.width` values other than `"full"`/`"boxed"` (the exact-size case needs the container's conditionally-shown `boxed_width` control, not verified); `image.alt` (the real `image` widget has no `alt` control at all — confirmed live; Elementor reads alt text from the attachment itself when `src` is a media id). Both compile successfully; the diagnostic just tells the caller the field wasn't applied.

23 unit tests (`server/src/dsl/v3.test.ts`), several asserting exact equality against real fixture-captured values (not just "some object shape").

**v4 column implemented (EMCP-051).** `server/src/dsl/v4.ts` registers real emitters for `container` (→`e-flexbox`), `heading` (→`e-heading`), `text` (→`e-paragraph`), `button` (→`e-button`), `image` (→`e-image`), `divider` (→`e-divider`). **v4's ground truth is not `GET /widgets/{type}`** — CLAUDE.md's own gotcha: atomic widgets' `get_controls()` is empty, their real schema lives in each class's `define_props_schema()`, a PHP method nothing built so far introspects. Every shape was confirmed by direct source reads (`modules/atomic-widgets/elements/**/*.php`, `modules/atomic-widgets/styles/style-schema.php`) and the committed fixtures — never inferred from v3's naming conventions.

**The recursive `$$type`/`value` wrapping — §3.2's own "single most likely v4 bug" — is confirmed from source, not just pattern-matched from fixtures:** `Plain_Prop_Type::validate()`/`Object_Prop_Type::validate()` (`prop-types/base/`) both require `is_transformable()`, meaning every prop at every nesting level is stored `{ $$type, value }`, recursively, with no exception. `toTyped()` is the one place that wrapping happens in `v4.ts`, reused by every emitter.

**A real, load-bearing design gap in `compile.ts` (EMCP-049) found and fixed while building this:** v4's local-class-name convention embeds the *owning element's own id* (`e-<elementId>-<suffix>`, confirmed live) — but `compile.ts`'s original design generated an element's id *after* calling its emitter, since v3 never needed it. Fixed by generating the id first and passing it via a new `EmitContext.elementId` field — the kind of gap EMCP-049 genuinely had no way to anticipate until a real v4 emitter needed it, closed here rather than worked around with a second id-generation path.

Local styles (§3.2: "Styling goes in the node's local `styles` array") are built for `layout`'s flex/spacing properties only, one desktop-only `"local"` class per element with mappable properties — confirmed real style-schema keys: `flex-direction`/`flex-wrap`/`justify-content`/`align-items` (string), `gap`/`width`/`min-height` (`size`, `{unit,size}`, confirmed live via `gap` in `v4-atomic.json`), `padding`/`margin` (`dimensions` — **logical** properties `block-start`/`inline-end`/`block-end`/`inline-start`, not physical sides; §2.6's box-shorthand order maps 1:1 for LTR content). No responsive/pseudo-state variants — that's EMCP-052's job, explicitly.

**Deliberately deferred, not guessed:** `grid` (own schema not read within this task); `icon`/`list`/`spacer`/`shortcode`/`html` (confirmed live via `GET /wp-json/emcp/v1/widgets` that the real v4 atomic set is exactly `e-button, e-component, e-divider, e-heading, e-image, e-paragraph, e-self-hosted-video, e-svg, e-youtube` — **there is no v4 icon or spacer widget at all**; `shortcode`/`html` have no atomic equivalent, but remain reachable on a v4 site via the DSL's own generation-agnostic `widget` escape rung); `video` (split across `e-self-hosted-video`/`e-youtube`, same URL-detection gap v3 deferred); `style`/`typography`/color/background/border DSL properties (real, confirmed `style-schema.php` entries exist for all of these — `color`, `font-family`, `background`, etc. — just not mapped in this task's scope); `link` on button/heading/image (the real `Link_Prop_Type`'s `destination` field is a `Union_Prop_Type` of `url`/`query` whose exact wire shape no fixture ever showed a real, non-default example of — warned, not guessed, the same discipline as v3's `layout.width`/`image.alt`).

`image.alt` **is** supported on v4 (confirmed via `image-src-prop-type.php`'s real shape) — a genuine capability v3 lacks (EMCP-050's own confirmed gap), not carried over as a limitation.

22 unit tests (`server/src/dsl/v4.test.ts`), several asserting exact equality against `v4-atomic.json`'s/`unicode-roundtrip.json`'s real captured values — including one real bug this test suite caught before it shipped: an early draft of the `container`/`e-flexbox` emitter always emitted a `classes` setting (even `{$$type:"classes", value: null}` for an uncustomized element with no local style needed), diverging from every fixture's actual "classes absent entirely when uncustomized" shape.

### 3.3 Invariants

Every compile must guarantee:

- Element IDs are 7-char hex, unique across the **whole** tree including nested widget children.
- `apply_template` and duplicate operations **regenerate IDs** — shared IDs share CSS selectors and produce style bleed that reads as a rendering bug.
- `__globals__` and `__dynamic__` on existing nodes survive a partial update unless explicitly cleared.
- Required document meta is set: `_elementor_edit_mode = 'builder'`, `_elementor_template_type`, `_elementor_version`, `_elementor_page_settings`.
- Nested-widget children (Nested Tabs / Accordion / Carousel) are emitted and traversed correctly — widgets are **not** always leaves.

**Implemented (EMCP-049) — the orchestration layer, deliberately not the emission tables.** `server/src/dsl/compile.ts`'s `compile(spec, siteProfile)` is pure and synchronous, exactly per §3.1's signature, and owns everything §3.2's per-generation emission tables (EMCP-050/051) would otherwise each have to reimplement: the recursive tree walk, ID generation (`generateUniqueId()` — 7-char hex, one `Set` threaded through the *whole* recursion, not per-level, so a collision between a container and its own great-grandchild is caught), diagnostic aggregation, `nativeness`/`rawRatio` computation, and the required `docMeta` shape. Per-node-type emission is a pluggable registry (`registerEmitter(nodeType, generation, emitter)`) that EMCP-050/051 populate — core itself ships exactly one real, working emitter: `widget` (§2.3's escape rung), the one type §3.2's own table already says is generation-agnostic ("passthrough `widgetType`" for both v3 and v4), checked for real against `siteProfile.widgetRegistry` (`WIDGET_NOT_AVAILABLE`, live-checkable without any emission table). Every other node type currently produces `EMISSION_NOT_IMPLEMENTED` — expected and correct at this stage, not a gap in this task.

`siteProfile.generation` is typed `'v3' | 'v4'` only, narrower than `domain/detect.ts`'s read-side `Generation` (which also reads `'legacy'` off existing content) — §5.1's own table says legacy is create-**never** ("Create: No"), so a compiler has no legacy emission target to begin with; new content always targets v3 (container) or v4, per solution.md §5.2's disambiguation rule.

Matches `parseSpec`'s (EMCP-048) all-or-nothing behavior exactly, for the same "fail loudly, not partially apply" reason `dslVersion` enforcement gives: any single node's compile failure — an unregistered emitter, an unavailable widget — empties the whole result (`elements: []`), never a partial tree with the bad node silently missing. 15 unit tests (`server/src/dsl/compile.test.ts`) cover: the empty-spec case, a real widget compiling end to end with a genuine 7-char hex id, `WIDGET_NOT_AVAILABLE` with the real registry as `allowed`, `EMISSION_NOT_IMPLEMENTED` for unregistered types, whole-tree id uniqueness across nested children, nested-child diagnostic paths, `nativeness`/`rawRatio` math (including that nested children count toward both, not just top-level nodes), and the emitter-registry mechanism itself (a fake emitter registered mid-test proves EMCP-050/051's real integration point works).

### 3.4 Diagnostics

Every compile returns diagnostics regardless of success, each carrying a JSON path into the spec:

```jsonc
{
  "path": "elements[2].children[0].style.color",
  "severity": "error" | "warning" | "info",
  "code": "TOKEN_UNRESOLVED",
  "message": "Token @brand is not defined on this site.",
  "allowed": ["@primary", "@secondary", "@text", "@accent"],
  "suggestion": "@primary"
}
```

`nativeness` and `rawRatio` are reported here — **warnings, never gates** (`solution.md` §14). The itemised list of non-native nodes, each naming the widget that should have been used, is also the compiler-coverage backlog.

---

## 4. Decompiler

`decompile(nativeElements, siteProfile) → spec` is required for three things: `save_as_template` storing specs rather than frozen native JSON, round-trip fixture testing, and letting the model edit a page it did not author.

**It is lossy by design.** Anything without a DSL representation decompiles to `widget` with native settings, or `raw`. Round-trip tests assert **semantic** equivalence — `compile(decompile(x)) ≈ x` after normalization — never byte equality.

**Implemented (EMCP-054).** `server/src/dsl/decompile.ts`'s `decompile(nativeElements, siteProfile) → { elements, diagnostics }` inverts exactly the same confirmed shapes `v3.ts`/`v4.ts` already forward-map (EMCP-050/051) — no new research, since the ground truth is identical in both directions. Reuses `domain/detect.ts`'s `detectNodeGeneration()` (EMCP-019) for per-node generation dispatch rather than reimplementing it.

**Deliberately never fails the way `compile()`/`parseSpec()` do.** Those exist to catch a spec author's mistake before it's written; `decompile()`'s job is the opposite — make *whatever a real page already contains* editable, even when it's ugly. Every diagnostic is `warning`/`info`, never `error`. The two fallbacks §4 itself names are both real here: an unrecognized `widgetType` falls back to the DSL's own `widget` escape rung, **verbatim and therefore lossless** (`compile()`'s built-in `widget` emitter round-trips it exactly); a legacy `section`/`column` (§5.1: legacy is read-only — the DSL has no legacy container type to decompile *to* at all) or any other genuinely unrecognized native shape falls back to `container` with `raw` holding the native content verbatim (still denylist/sanitisation-checked on the way back through `compile()`, per §2.8 — decompiled content isn't exempt from those rules just because it came from a real page). Settings a recognized node type's reverse-mapper doesn't consume are preserved the same way, via `raw`, not silently dropped.

24 unit tests (`server/src/dsl/decompile.test.ts`), including three genuine round-trip tests through the **real, committed fixture set** (not hand-crafted data): `v3-container.json`'s heading text and icon widgetType survive `decompile()`→`compile()`; `deep-nested.json`'s full 5-level nesting depth survives; `unicode-roundtrip.json`'s em-dash/Arabic/CJK content survives exactly. A fourth confirms the widescreen-responsive fixture's *structure* reverses correctly even though its specific typography properties don't — "lossy by design" demonstrated against real data, not just asserted in prose.

---

## 5. Normalized read shape

One shape for all four generations, so the model never learns the difference.

```jsonc
{
  "id": "a1b2c3d",
  "ref": "hero",
  "kind": "layout" | "content",
  "type": "container",
  "generation": "v4",
  "native": { "elType": "e-flexbox", "widgetType": null },
  "label": "Hero",
  "childCount": 3,
  "children": [ /* … */ ]
}
```

At the depth limit a node emits `{ "id": …, "type": …, "truncated": 5 }`.

**Label resolution**, in order: the Navigator title if set; else the first text-bearing setting stripped of markup and truncated to 40 characters; else the type name. Labels are **sanitised** — markup, newlines and zero-width characters removed (`solution.md` §9.1).

**Digest budget** is a measured acceptance criterion, not prose: **≤ 4,000 tokens at depth 3 across the fixture set**, measured with `count_tokens`.

---

## 6. Plugin REST contract

Base: `/wp-json/emcp/v1`. Versioned in the path; the server declares a minimum plugin version and fails loudly on mismatch at connect time. **Implemented (EMCP-010):** `server/src/wp/contract.ts`'s `MINIMUM_PLUGIN_VERSION` (currently `0.1.0`), checked against `GET /site`'s `plugin_version` on every call that reaches the plugin — there's no persistent connection to gate once under MCP 2026-07-28 (§3), so this is the closest equivalent "connect time" this transport has. A mismatch throws `PluginVersionMismatchError`, surfaced by tools as `isError: true` with both versions named in the message.

Every route has a real permission callback. Cookie-authenticated requests are rejected outright (CSRF). JSON content type enforced.

| Method | Route | Purpose |
|---|---|---|
| GET | `/site` | Version, generation default, Pro tier, breakpoints, experiments, CSS print method, plugin version |
| GET | `/registry/snapshot` | Full curated widget + control schema (§9.2) |
| GET | `/widgets` | List — **never** calls `get_controls()` across the registry |
| GET | `/widgets/{type}` | Controls, with `detail` and forced stack init |
| GET | `/documents` | List pages |
| POST | `/documents` | Create a new page — always `draft` (§6.9) |
| GET | `/documents/{id}` | Native elements, meta, generation, document hash |
| PUT | `/documents/{id}` | Write via Document API — draft/autosave aware (§6.3). `operations[]` is `set_settings` (per-element patch) or `replace_tree` (whole-tree replace, EMCP-055) |
| PUT | `/documents/{id}/page` | Update page attributes (title, page template) — not document content (§6.9) |
| GET | `/documents/{id}/lock` | `wp_check_post_lock()` state |
| POST | `/documents/{id}/publish` | Promote autosave onto parent, approval-token gated (§7.5) |
| GET | `/kit` | Global styles |
| GET | `/global-classes` | v4 classes and variables |
| GET/POST | `/media` | List / upload — URL fetch (SSRF-hardened) or direct multipart, §6.11, EMCP-063 |
| GET/POST | `/templates` | List / save — real table (§6.10, EMCP-060), spec stored opaquely |
| GET | `/templates/{id}` | One template's full spec (§6.10, EMCP-061) — `apply_template`'s read |
| POST | `/preview-token` | Signed single-post token (§6.5) |
| POST | `/snapshots` | Capture prior state |
| POST | `/snapshots/{id}/restore` | Rollback |
| POST | `/cache/invalidate` | Element cache + CSS, with warm-up |

**`GET /site` — implemented (EMCP-004).** Response shape, all fields read from Elementor's runtime at call time, never hardcoded:

```jsonc
{
  "elementor_version": "4.2.3",
  "generation_default": "v4" | "v3" | "legacy",   // Experiments_Manager::is_feature_active('e_atomic_elements' | 'container')
  "pro_tier": "free" | "pro-tier-unresolved",       // Essential/Advanced split deferred — no Pro install to introspect yet (§12)
  "breakpoints": {
    "<name>": { "enabled": bool, "direction": "min" | "max", "value": number }
    // one entry per Elementor::$instance->breakpoints->get_breakpoints(), disabled ones included
  },
  "experiments": { "element_caching": bool, "optimized_markup": bool },
  "css_print_method": "external" | "internal",
  "plugin_version": "0.1.0"
}
```

Auth: `Authorization` header required — absence is treated as cookie authentication and rejected with `401 emcp_cookie_auth_rejected` regardless of whether a valid nonce would otherwise pass WordPress's own cookie-auth check (solution.md §9.7's "rejected outright"). A present-but-insufficient-capability user gets `403 emcp_forbidden`. Verified live against both sandboxes with Application Passwords over HTTP + `WP_ENVIRONMENT_TYPE=local` (`CLAUDE.md`).

**`GET /registry/snapshot` — implemented (EMCP-017).** Same auth as `GET /site` (`Capabilities::can_read`, shared between both routes). Response shape:

```jsonc
{
  "elementor_version": "4.2.3",
  "plugin_version": "0.1.0",
  "widget_count": 149,
  "widgets": [
    {
      "name": "e-heading",
      "title": "Heading",
      "categories": ["v4-elements"],
      "keywords": ["heading", "title", "text"],
      "controls": {
        "<control_name>": { "type": "…", "label": "…", "default": …, "options": {…}, "condition": {…}, "conditions": {…} }
        // layout-only control types (section/tab/divider/heading/popover_toggle)
        // are omitted — they carry no settable value
      }
    }
    // sorted by name — deterministic, not registration order
  ]
}
```

Forces each returned widget's control stack via `get_controls()` (§6.2) — this endpoint's whole job is the full schema, unlike `list_widgets` (§7, EMCP-027), which must never do this across the registry. Registration itself is Elementor's own lazy `get_widget_types()` → `init_widgets()` path (verified against Elementor 4.2.3's actual source, not assumed) — confirmed live to correctly reach 149 widgets on `wp-v4-pro` vs. 141 on `wp-v3-free`, the difference being exactly the eight V4 atomic (`e-`-prefixed) widgets, matching the `e-` detection rule in §5.2/`CLAUDE.md`. **Open item, not yet resolved:** whether Elementor Pro's *own* widget registration needs anything beyond this is unverified — neither sandbox has Pro installed. Revisit once the zip is supplied rather than guessing now.

### 6.1 Why the plugin stays thin

It owns only what must run in PHP: registry introspection, Document API writes, kit and global-class reads, media, preview tokens, cache invalidation, and snapshot storage. No DSL, no compilation, no MCP awareness.

### 6.2 Registry introspection caveats

- Controls are **lazily built** — `describe_widget` must force stack initialisation per widget.
- Registration is **context-sensitive**: many Pro and third-party widgets register only during editor/frontend bootstrap, so a plain REST request can see a smaller registry than the editor does. The endpoint must bootstrap Elementor's context explicitly, or the server under-reports vocabulary and then rejects valid specs.
- Validation must honour control `condition` / `conditions`, or settings that Elementor ignores at render time pass validation — producing "wrote it, nothing changed".

### 6.3 Write paths

`PUT /documents/{id}` behaves differently by target state, and the response says which path it took:

| Target | Behaviour |
|---|---|
| New / unpublished | Write post, status `draft` |
| Published | Write **autosave revision**; parent untouched |

**Implemented (EMCP-045).** `{ operations[], document_hash, override_lock? }` → refuses if a different user holds the editor lock (§6.3, EMCP-042, unless overridden), compare-and-swaps against the current hash (§6.4, EMCP-041), validates every operation's element exists before applying any (§7.2's "all operations validate before any apply"), then merges every operation and calls `Document::save()` **once** for the whole batch. The table above is now fully live: a **published** post's target is resolved to its live autosave (created on the spot via Elementor's own `Document::get_autosave( 0, true )` if none exists yet — never a hand-rolled `wp_create_post_autosave()` call, which would skip Elementor's own `copy_elementor_meta()` step) *before* the hash is even computed, so the CAS check and the save both land on the same document; a non-published post (draft, pending, etc.) still writes the parent directly. The response carries a `source: "parent"|"autosave"` field alongside `document_hash` so a caller knows which document it just wrote. Exposed via the real `edit_elements` MCP tool since EMCP-043 (§7.2) — `server/src/wp/client.ts`'s `editElements()` is its Node-side caller; `server/src/tools/editElements.ts`'s handler determines the same `source` Node-side (parent status `publish` → try `GET ?source=autosave`, falling back to the parent-fetched document on a 404) so its structural-validation read and pre-write snapshot (`captureSnapshot(postId, source)`) both target the document the write will actually land on. Live-verified end to end on `wp-v4-pro`: a first edit to a published page creates the autosave and leaves the parent's `document_hash` unchanged; a second edit reuses the same autosave (not a new one each time — Elementor's own `get_autosave_id()` lookup finds it via `Utils::get_post_autosave()`); `GET /documents/{id}` (parent) and `GET /documents/{id}?source=autosave` diverge exactly as expected throughout.

**A real WordPress-core gotcha found and fixed in the same task**: `update_post_meta()`/`add_post_meta()`/`delete_post_meta()` (`wp-includes/post.php`) silently **redirect a revision post id to its parent** via `wp_is_post_revision()` — confirmed live by reading core source, not assumed, after a restore-onto-autosave test appeared to succeed (200, `restored: true`) while actually writing the *parent* and leaving the autosave untouched. `get_post_meta()` has no such redirect, which is why every *read* path (`show()`, `SnapshotService::capture()`) was unaffected — only a direct *write* to a revision/autosave post id via the wrapper functions hits this. Elementor's own `copy_elementor_meta()` (`includes/db.php`) hits the identical trap and works around it with `update_metadata( 'post', $to_post_id, $meta_key, $value )` instead, with the source comment "Don't use `update_post_meta` that can't handle `revision` post type" — confirmed by reading that source too. `SnapshotService::restore()` now does the same for every meta key it writes (`_elementor_data`, `_elementor_page_settings`, the doc-meta trio). Added to `CLAUDE.md`'s gotcha list.

**EMCP-055 addendum:** `PUT /documents/{id}`'s `operations[]` gained a second shape, `{ op: "replace_tree", elements }` — `apply_page_spec`'s write path (§7.1), required to be the sole operation in its batch. Shares the lock check, hash CAS, and autosave branching above unchanged; skips the per-operation element-existence check `set_settings` needs (there is no target id) and calls `Document::save()` with the given `elements` verbatim. The response's `document_hash` is now computed from the **persisted** `_elementor_data`/`_elementor_page_settings`, re-read after `save()` returns, not the in-memory pre-save elements — `save()` enriches fresh element shapes (missing `styles`/`interactions`/`editor_settings`/`version`) with defaults, which made the pre-save hash wrong for any write introducing genuinely new element shapes (found live via `apply_page_spec`, invisible to `set_settings` since it only ever patches elements that already carry those fields).

`GET /documents/{id}` accepts `?source=autosave|parent`. `render_preview` on a published page must request the autosave, or the loop grades the wrong content.

Both `GET /documents` and `GET /documents/{id}` (EMCP-034) include a `link` field (`get_permalink()`) alongside `edit_url` — `render_preview`'s navigation target, since the plugin is the only party that knows the post's real front-end URL.

`GET /documents/{id}` (EMCP-039) also includes `status` (`$post->post_status`) — `rollback`'s publish-state gate: a rollback targeting a currently-published post needs the same out-of-band approval `publish_draft` does (solution.md §8). That approval mechanism now exists (`ApprovalTokenService`, EMCP-047) but `rollback` hasn't been wired to accept a `confirmation_token` yet — a deliberate scope boundary EMCP-047 drew, not an oversight (see §7.5's own note) — so `rollback` still refuses outright on a published target rather than allowing an unguarded rollback of live content.

### 6.4 Document hash

Covers the element tree **and** page settings, computed server-side over a canonical serialization. `PUT` requires the caller's hash and performs compare-and-swap **inside the same request**; a client-supplied hash is never trusted as authoritative. On mismatch: `409`, returning the current hash. The write response returns the **new** hash, so an edit costs one round trip rather than two.

**Implemented (EMCP-041).** `DocumentsController::update()` computes the current hash via `DocumentHasher` (the same class `GET /documents/{id}` and snapshot capture use — one implementation, never three independently drifting) *before* merging anything, and compares before any write happens — closing the two-round-trip gap a client-side "read hash, then write" pattern would leave open for a concurrent write. On mismatch, returns a flat `WP_REST_Response` (not `WP_Error` — the caller needs to read `document_hash` out of the body, the same top-level key the success response uses) with `{ id, document_hash, message }` and status `409`. `server/src/wp/client.ts`'s `updateElementSettings()` now requires an `expectedHash` argument and throws a dedicated `DocumentHashMismatchError` (carrying `currentHash`) on `409`, distinct from the generic `WordPressApiError` every other non-2xx response produces — live-verified: a stale hash is rejected with the real current hash, the rejected write never touches content, and a subsequent write using the correct hash reproduces the exact original hash on revert. **Not yet built:** a real "summary of what changed" beyond the bare hash — deferred; the caller can always re-fetch via `GET /documents/{id}` to see the full current state.

`PUT` also refuses when `wp_check_post_lock()` reports a human editing, unless explicitly overridden.

**Implemented (EMCP-042).** Runs *before* the hash CAS check in `DocumentsController::update()` — a human actively editing is a more fundamental block than a stale hash. `wp_check_post_lock()` is WordPress core's own mechanism (`_edit_lock` post meta, `"timestamp:user_id"`, a 150-second default window) — the same one the block editor's own "someone else is editing" warning uses. It only fires for a genuinely *different* user than the one making the request; a caller editing under the same authenticated user never blocks itself, live-confirmed. On conflict: `423` (Locked) with `{ id, locked_by: { id, name }, message }` — a separate status from the `409` hash mismatch uses, since these are different conflict classes a caller needs to distinguish. `override_lock: true` bypasses it — an explicit request parameter, never a default. `GET /documents/{id}/lock` (row above; frozen since EMCP-010, unbuilt until now) shares the same lock-check logic and lets a caller check lock state without attempting — and being refused — a write first. `server/src/wp/client.ts` gained `updateElementSettings()`'s `overrideLock` option, a dedicated `DocumentLockedError` (carrying `lockedByUserId`/`lockedByName`, distinct from `DocumentHashMismatchError`), and `getLockStatus()`. Live-verified with a real second WordPress user: refused with the correct locking user's id/name, the refused write never touched content, `override_lock: true` genuinely bypassed it, and `GET /documents/{id}/lock` correctly reported both the unlocked and locked states.

### 6.5 Preview tokens

Signed, single post ID, TTL in minutes, single-use via a nonce table, non-enumerable, revocable, bound to a `renderer` audience. Sent as a header where possible; if a query parameter is unavoidable, responses set `Referrer-Policy: no-referrer` and `Cache-Control: no-store, private`. The endpoint does its own `read_post` gating rather than leaning on WordPress's preview path. Issuance and redemption are both logged.

`render_preview` (EMCP-034) also uses the presence of a signature-valid `X-EMCP-Preview-Token` (checked, not consumed — see `PreviewTokenService::verify_render_token()`) to suppress WordPress's own `redirect_canonical` for that request. This exists because the dev sandboxes' `WP_HOME`/siteurl carry a host:port only reachable from the host machine, not from the renderer's docker network segment (CLAUDE.md) — without it, every renderer navigation 301s into a dead end. It grants no content access; it only cancels a redirect.

### 6.6 Slashing

`_elementor_data` written directly requires `wp_slash( wp_json_encode( … ) )`. The Document API covers the main write path, but **snapshot restore writes prior state back directly** and will hit this. Fixture: `unicode-roundtrip` (§9.1) — live-verified end to end (EMCP-037): captured, corrupted, restored, and the em-dash/Arabic/CJK content, plus the document hash, matched the pre-corruption state exactly.

**EMCP-045 addendum:** a direct meta write also has to pick the right *function*, not just slash correctly — `SnapshotService::restore()` writes via `update_metadata( 'post', $target_id, … )`, never the `update_post_meta()` wrapper, because `$target_id` can be an autosave (a `revision`-type post) and the wrapper silently redirects any revision id back to its parent (§6.3's gotcha addendum). `wp_slash()` still applies exactly the same either way — the fix is which write function to call, not the slashing itself.

### 6.7 Cache invalidation

`POST /cache/invalidate` (EMCP-035) — `{ post_id, warm?: true }` → `{ post_id, invalidated, warmed }`. `Document::save()` already clears both Post CSS and the Element Cache postmeta as a side effect of every save that goes through it (confirmed live) — this route exists for the write path that deliberately doesn't: **snapshot restore**, which writes `_elementor_data` directly (§6.6). `warm` (default `true`) issues a real HTTP loopback request against the post's own front end, carrying a freshly-issued, short-TTL preview token so it isn't itself blocked by the sandbox's `redirect_canonical` mismatch (§6.5) — the same regeneration a real visitor's first request after a save triggers, just performed proactively rather than left to whoever asks next.

### 6.8 Snapshots

`POST /snapshots` — `{ post_id, source?: "parent"|"autosave" }` → `{ id, post_id, source, hash, created_at }`. `POST /snapshots/{id}/restore` → `{ post_id, restored, hash, source }`. Stored in a real table (`{$wpdb->prefix}emcp_snapshots`, mirroring the preview-token nonce table's pattern) — `solution.md` §10: "Stored site-side so content stays with the site and rollback survives a Node outage." `_elementor_data`/`_elementor_page_settings` are captured **verbatim** (the exact raw string `get_post_meta()` returns), not re-encoded, so restore reproduces exactly what was there. `hash` is computed via the same `DocumentHasher` `GET /documents/{id}` uses (extracted into a shared class, EMCP-037, so the two routes can never independently drift on what "the hash" means) — a caller can compare a fresh capture's hash against a prior one without a second round trip. Restoring is a write; the permission check (`edit_post` on the snapshot's target post) runs **before** `SnapshotService::restore()` is ever called, not after — restore() itself writes unconditionally once invoked, so gating has to happen strictly earlier in the request, not as a post-hoc check on its result. A restore does not itself invalidate cache — always follow with `POST /cache/invalidate` (§6.7).

**Implemented (EMCP-045): autosave-aware capture and restore.** Both ends of the snapshot lifecycle now honour `source` fully, not just at capture time. `capture()` with `source: "autosave"` and no existing autosave **creates one** on the spot (same `Document::get_autosave( 0, true )` call the write path uses) rather than 404ing, so a caller can always snapshot immediately before a write without a chicken-and-egg failure; `page_settings` for an autosave capture is read from the autosave's own copy of `_elementor_page_settings` (`copy_elementor_meta()` puts one there), not the parent's, so restore later writes back to the same document it read from. `restore()` resolves its write target from the **snapshot's own recorded `source`** — a `'parent'`-sourced snapshot writes the parent, an `'autosave'`-sourced one finds-or-creates the current autosave and writes there — closing a real bug where an earlier draft of this fix always wrote the parent regardless of `source`, which would have silently corrupted a published page's live content with autosave-only edits on any restore of an autosave snapshot. Live-verified end to end: capture → second edit → restore correctly reverts only the autosave, with the parent's `document_hash` unchanged throughout the whole sequence.

### 6.9 Page creation and attributes

**Implemented (EMCP-046).** `POST /documents` — `{ title, post_type?, page_template? }` → `{ id, source: "parent", status, type, link, edit_url, page_template, elements, meta, document_hash }`, `201`. Always creates a `draft` — no `status` input exists, matching solution.md §5.4's write posture table ("New page → post with `draft` status"); publishing is `publish_draft`'s job (EMCP-047, not built yet).

Modelled directly on Elementor's own `modules/mcp/abilities/create-page-ability.php` — Elementor 4.2.3 ships its own MCP "create page" ability, read live rather than guessed — for the parts that matter for correctness: `post_type_exists( $type ) && post_type_supports( $type, 'elementor' )` validates the post type the same introspective way CLAUDE.md's "introspect, never hardcode" already applies to widgets (defaults to `page`); `get_post_type_object( $type )->cap->create_posts` is the real capability for that post type, never a hardcoded `edit_pages`; `Document::set_is_built_with_elementor( true )` is the one real Elementor API for "mark this post `_elementor_edit_mode = builder`," rather than writing that meta key by hand and risking drift from whatever internal representation (currently the string `'builder'`) a future Elementor version chooses.

Goes one step further than Elementor's own minimal ability, which leaves `_elementor_template_type`/`_elementor_version` unset until a human's first edit in the real editor: this route also calls `Document::save( [ 'elements' => [] ] )` immediately — confirmed live by reading `core/base/document.php` that `save()` always stamps both of those itself — so `GET /documents/{id}` returns a fully valid, immediately-editable document with a real `document_hash` right away, matching prd.md's own wording for this task ("Sets `_elementor_edit_mode` and required meta").

`_wp_page_template` is always written explicitly ("page template explicit," prd.md's own words) — never left absent for WordPress to resolve implicitly — and validated against the real, introspected list `wp_get_theme()->get_page_templates( null, $post_type )` returns (confirmed live: already includes Elementor's own `elementor_canvas`/`elementor_header_footer`/`elementor_theme` entries, registered via the standard `theme_page_templates` filter — no Elementor-specific slugs are hardcoded) plus the always-valid `'default'` sentinel ("use the theme's own default template," which `get_page_templates()` never lists as an option itself).

`PUT /documents/{id}/page` — `{ title?, page_template? }`, at least one required → `{ id, title, page_template, status, link }`. **Deliberately a separate route from `PUT /documents/{id}`** (`edit_elements`'s frozen `operations[]`/`document_hash` contract, §7.2) — a page template or title change is not "document content" in the sense the rest of the write layer means it. `_wp_page_template` is a real WordPress post attribute controlling which PHP template renders the post on *every* request regardless of publish state; there is no meaningful "draft" version of it the way there is for `_elementor_data`, so unlike `edit_elements` (EMCP-045) this route **never branches to an autosave** — it always writes the real post directly, published or not, the same way a title change always takes effect immediately rather than being staged. No document-hash CAS either, for the same reason: the compare-and-swap protects the element tree from a concurrent editor session; title/template aren't part of that tree or its hash.

Both routes are `edit_post`/`create_posts`-gated the same way every other write route is, and neither is wired into the ledger/rollback system (§7.6) — `create_page` has no "prior state" to roll back to (nothing existed before), and `rollback` restores `_elementor_data`/`_elementor_page_settings`, not title/page template, so ledgering `update_page` would create an entry `rollback` couldn't actually act on. A future task revisiting rollback's scope should treat this as a deliberate boundary, not an oversight.

Live-verified end to end through the real `/mcp` endpoint: `create_page` returned a fully populated, immediately-editable document (confirmed by feeding its `post_id` straight into `get_page_structure`); a repeat call under the same `idempotency_key` returned the identical `id` rather than creating a second page (confirmed via `list_pages`); `update_page` changed both title and template on a published post (`document_hash`/elements confirmed unchanged throughout) and correctly refused a call with neither field set; template validation rejected an unknown slug with a clear error.

### 6.10 Templates

**Implemented (EMCP-060).** `GET /templates` → `{templates: [{id, name, source_post_id, created_at}], count}`, no spec content — a lightweight listing, same split `GET /documents` vs. `GET /documents/{id}` already establishes. `POST /templates` — `{name, spec, source_post_id?}` → `{id, name, created_at}`, `201`. A real table (`{$wpdb->prefix}emcp_templates`, `plugin/src/Templates/TemplateService.php`), mirroring `SnapshotService`'s own pattern (§6.8) rather than post meta on a hidden post — site-side storage, per solution.md §10's reasoning for snapshots ("stored site-side so content stays with the site") applied here too: a template is exactly the kind of asset a site owner expects to find on their own site.

**The plugin stores `spec` opaquely** (§6.1: "no DSL... no MCP awareness") — it validates only that `name`/`spec` are non-empty, never the spec's own shape; that's `parseSpec()`'s job, already run Node-side before this route is ever reached. `POST /templates` is gated on `current_user_can('edit_posts')`, a general "can create content" capability, since a template has no single target post the way `edit_post`-gated routes do.

Cross-site portability (prd.md Task 62, not yet built) comes from the DSL spec itself being generation-agnostic and re-`compile()`-able against whatever site `apply_template` eventually targets — not from centralised storage. Storing frozen native JSON instead would have made every template permanently tied to the generation/registry of whichever site produced it.

**EMCP-061 addendum:** `GET /templates/{id}` — `{id, name, spec, created_at}`, `404` if unknown — added once `apply_template` (§7.9) actually needed a specific template's full `spec`; `list_all()`/`GET /templates` deliberately never returns it (a lightweight listing, same split `GET /documents` vs. `GET /documents/{id}` already establishes).

### 6.11 Media

**Implemented (EMCP-063), resolving D1** ("reference-design ingestion — URL vs out-of-band upload" — resolved as **both**). `GET /media` → `{media: [{id, url, filename, mime_type, created_at}]}`. `POST /media` accepts exactly one of `{ url, filename? }` (server-side fetch) or a multipart `file` field — never both, never neither. Every real validation step (solution.md §9.7, implemented literally, not just cited) runs identically for both paths in `plugin/src/Media/MediaService.php`:

- **Content-derived MIME, not extension-based.** Every payload is sniffed with `finfo` (`FILEINFO_MIME_TYPE`) before anything about its filename or declared `Content-Type` is trusted.
- **Category-based denial, not SVG alone.** An explicit denylist (`image/svg+xml`, `text/html`, `application/xhtml+xml`, `text/xml`, `application/xml`, `application/pdf`, plus PHP MIME variants) checked against the *sniffed* type.
- **Decoded pixel cap** (~40 megapixels) against decompression-bomb-style images, via `getimagesizefromstring()`.
- **EXIF stripped** by round-tripping raster images through GD (`imagecreatefromstring()` → re-encode) — GD never preserves EXIF, so this is stripping via a lossless-for-the-purpose side effect of re-encoding, not a dedicated EXIF parser. Best-effort: an image GD can't decode keeps its original bytes rather than failing the whole upload.
- **Unique filenames** via WordPress's own `wp_unique_filename()`.

**The URL path is SSRF-hardened per solution.md §9.5, implemented as a manual per-hop redirect loop** (`fetch_url_safely()`), not delegated to WordPress's native redirect-following (which would follow a `Location` header to an internal address without re-validating it — exactly the gap §9.5 calls out). Each hop: `validate_url_safe()` rejects non-`http(s)` schemes, then resolves the host and rejects it via `filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)` — the standard PHP idiom for "not RFC1918, not loopback/link-local/reserved," not a hand-rolled CIDR list — *before* the request for that hop is even made. `redirection => 0` on every `wp_remote_get()` call disables native following entirely; a 3xx response's `Location` header becomes the next loop iteration's URL, re-validated from scratch.

**Node side, D1's "URL" half:** `upload_media` (`{url, filename?} → {id, url, filename, mime_type, width, height}`) — the only ingestion shape an MCP tool can offer at all, since tool inputs are JSON and a model cannot re-emit an image it was shown as bytes. **D1's "out-of-band" half needs no MCP tool** — a human calls `POST /media` directly with a multipart `file`, bypassing the model entirely; `list_media` (`{} → {media: [...]}`) is how the model discovers what an out-of-band upload produced, doubling as the general listing tool.

Live-verified on `wp-v4-pro`, adversarially, not just the happy path: a URL that redirects through a public host to `http://127.0.0.1/wp-login.php` was blocked at the *second* hop (proving per-redirect revalidation, not just entry-URL checking); direct requests to a loopback address, the cloud-metadata link-local address (`169.254.169.254`), and an internal Docker service hostname (`db-wp`, which resolves to a private container IP) were all blocked with the same `emcp_ssrf_blocked` diagnosis; a `file://` URL was rejected on scheme alone; an SVG payload containing a `<script>` tag, uploaded with a spoofed `.jpg` extension and a spoofed `image/jpeg` declared `Content-Type` via direct multipart upload, was correctly detected as `image/svg+xml` by content sniffing and rejected — extension and declared type were both wrong, and neither was trusted. A genuine image succeeded via both paths (URL fetch through a redirect; direct multipart upload), with real dimensions extracted and a real attachment created, confirmed via `list_media` showing both. EXIF stripping's code path was not independently live-confirmed against a source image carrying real EXIF data — noted as an honest gap, not silently assumed correct.

---

## 7. Tool contracts

All 25 tools share conventions:

- `outputSchema` on every tool; results also carry serialized JSON in a text block for compatibility.
- Deterministic ordering in `tools/list`; `cacheScope: "private"`; `ttlMs` long for `list_widgets` / `get_site_info` / `get_global_styles`, `0` for anything page-derived.
- Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) set on all — as UX hints only. **No safety control depends on them.**
- No `site_id` argument. The connector URL binds the session to one site (`solution.md` §3).
- Descriptions state *when to use and when not to*, especially for the confusable pairs: `apply_page_spec` vs `edit_elements`, `get_page_structure` vs `get_element` vs `find_elements`, `update_page` vs `publish_draft`.

### 7.1 `apply_page_spec`

```
in:  { post_id, document_hash, spec, dry_run?, idempotency_key? }
out: { document_hash, diagnostics[], nativeness, raw_ratio, applied: bool, path: "draft"|"autosave" }
```

`dry_run` is a **structurally separate code path** that cannot write — not a late branch in the write path.

**Implemented (EMCP-055).** `document_hash` was added to the input against this section's own earlier draft, which omitted it — a full-tree replace is exactly the kind of write the rest of §6/§7 treats as needing compare-and-swap (`edit_elements`, EMCP-041), and shipping it without CAS would let a stale caller silently clobber a concurrent edit; the omission read as an earlier oversight, not a deliberate design choice, once this task actually had to write the safety ring for it. Pipeline: `parseSpec()` (grammar, no network call) → fetch the target document (parent, or its live autosave for a published post, same source-resolution rule EMCP-045 established) → `buildSiteProfile()` (`server/src/tools/siteProfile.ts`, the first real caller to assemble a `SiteProfile` from live `GET /site` + `GET /widgets` calls rather than a hand-built test fixture) → `compile(spec, siteProfile)` → any compile error refuses the whole call, nothing written → `dry_run` returns here, before any snapshot/write call exists in the code path at all → otherwise: snapshot → write → cache invalidation → ledger entry, identical machinery to `edit_elements`.

The write itself reuses `PUT /documents/{id}` — no parallel write route — through a second operation shape, `{ op: "replace_tree", elements }`, added to the same `operations[]` array `edit_elements`'s `set_settings` already uses (`plugin/src/Rest/DocumentsController.php::update()`, §6.3). Required to be the sole operation in its batch (mixing a whole-tree replace with a per-element patch has no coherent meaning). It skips the per-operation "does this element id exist" check `set_settings` needs (there is no target id — the whole tree is the target) and calls `Document::save()` with the compiled elements verbatim, sharing the lock check, hash CAS, and autosave branching every other write through this route already gets.

**A real bug found and fixed via live testing, not caught by unit tests:** the very first live write returned a `document_hash` that didn't match what a `get_page_structure` call one request later reported. Root cause, confirmed by inspecting the persisted element directly (`get_element`): `Document::save()` enriches whatever element data it's given with fields a caller's input may not carry — a freshly compiled V4 atomic element has no `styles`/`interactions`/`editor_settings`/`version` (the compiler never sets them, §3.2's emission tables don't cover style props yet), and `save()` adds them as `[]`/`"0.0"` defaults. `set_settings` never surfaced this, because it only patches settings onto elements that already exist and therefore already carry those fields; `replace_tree` is the first write path to hand `save()` genuinely new element shapes. Fixed by re-reading the persisted `_elementor_data`/`_elementor_page_settings` **after** `save()` returns and hashing that, instead of hashing the in-memory pre-save `$elements` — protects both operation shapes with one fix. Live-verified: the returned hash and a subsequent `get_page_structure` hash now match exactly.

Live-verified end to end through the real `/mcp` endpoint on `wp-v4-pro`: a clean spec compiled and wrote real `e-heading`/`e-paragraph` elements in one call (`applied: true`, `path: "draft"`); a stale `document_hash` was refused with the real current hash, content unchanged; `dry_run: true` compiled and reported nativeness/diagnostics against the real live registry without ever calling the write path; a spec compile error (an unavailable widget) was refused with the real diagnostic, nothing written; `idempotency_key` replay returned the identical cached result on a retry using an otherwise-stale hash, confirmed via `list_changes` showing exactly one ledger row for the two calls; `rollback` against an `apply_page_spec` ledger entry correctly restored the pre-write snapshot, hash-verified.

`validate_page_spec` (`{ spec } → { valid, diagnostics[], nativeness, raw_ratio }`, no `post_id`) is the read-only sibling — per solution.md §5.4, "standalone... for checking a spec before a target page exists." Same `parseSpec()` → `buildSiteProfile()` → `compile()` pipeline, never a document fetch, never a write; use `apply_page_spec` with `dry_run: true` instead to validate against a *specific* existing page's current state.

**Itemised nativeness diagnostics (prd.md's own words for this task: "nativeness and raw_ratio reported as warnings with itemised offending nodes"), built into `compile()` itself, not the tool layer** — `compileNodes()` now pushes one `NATIVENESS_LOW` warning per node using the `html` escape rung or `raw`, naming the exact path, alongside the two aggregate numbers §3.4 already documented. Central and generation-agnostic, the same architectural choice `raw` supervision (EMCP-053) already made for the same reason: the mechanic doesn't vary by generation or node type, only whether it fires.

### 7.2 `edit_elements`

```
in:  { post_id, document_hash, operations[], idempotency_key? }
out: { document_hash, results[], diagnostics[] }
```

Operation items are a **flat object** with `op` as a required enum — not a JSON Schema `oneOf` at item level, which is where models reliably produce malformed input. Combination validity is enforced server-side with precise errors. `maxItems` is set and stated. The description carries a worked multi-operation example.

**Transaction semantics, stated in the tool description *and* in every error:** all operations validate before any apply; the batch is one document save; a failure applies nothing. Without that in the error text, a model re-issues the earlier operations and duplicates content.

**Implemented (EMCP-043) — the first real mutating MCP tool this project has registered.** `maxItems: 20`. Only `op: "set_settings"` exists today (`{ op, element_id, settings }`, a shallow merge onto that element's existing settings) — the enum has room for more without a breaking change, but nothing beyond it is built. Pipeline, in order: parse/shape-validate the batch (malformed operations refuse everything, `isError: true`, before any network call) → fetch the current document → **structural validation for every operation** (widget exists, settings keys real, control conditions honoured — `server/src/domain/validate.ts`, EMCP-036, against the real live registry, one `getWidgetDetail()` fetch per distinct widget type even across many operations targeting it) → if any operation fails validation, refuse the whole batch with every diagnostic, apply nothing → snapshot (EMCP-037) → `PUT /documents/{id}` (post-lock check, EMCP-042 → hash CAS, EMCP-041 → per-operation element-existence check, defense in depth → one `Document::save()` for the whole batch, EMCP-040/043) → cache invalidation (EMCP-035) → ledger entry (EMCP-038, **the first real, live-wired write** — correlation id threaded from the actual Fastify request id, `resolveCurrentSite()` for `site_id`, EMCP-039). A ledger-write failure never fails a call whose WordPress write already succeeded — the ledger gap is real (no OAuth subject yet, `LOCAL_SUBJECT` placeholder) but is never allowed to make a successful edit look like it failed.

Live-verified end to end, not just unit-tested: a typo'd control name refused the whole two-operation batch with a real diagnostic and `suggestion`, confirmed nothing changed; the same batch with correct settings applied both operations in one save; `list_changes` showed the real ledger row with a real correlation id; `rollback` reverted both elements, hash-verified back to the exact pre-batch state; a stale-hash retry was refused with the real current hash. The pre-rollback safety snapshot's hash was independently confirmed to match the mid-batch (not pre- or post-rollback) state, proving it captured a real intermediate point, not a no-op.

**`idempotency_key` implemented (EMCP-044).** Scoped to `(subject, site, key)` via EMCP-013's already-existing unique-indexed `idempotency_keys` table (`server/src/idempotency/store.ts`, the first code to read/write it). Checked *before* anything else runs — a cache hit returns the stored result immediately, without fetching the document, snapshotting, or calling `PUT /documents/{id}` at all. **Deliberately only caches a result that reached a real write** (`isError: false`) — a validation failure or a lock/hash refusal has no side effect, so a repeat under the same key re-runs fresh rather than replaying a stale rejection; only a genuine "this exact write already happened" case is cached. Insert is `onConflictDoNothing` against the unique index, not a read-then-write upsert, so two concurrent retries under the same key can't both win. A missing/unregistered site degrades to a normal non-idempotent write rather than blocking the call — idempotency is best-effort infrastructure, not a hard dependency of the write path itself.

Live-verified with a genuine retry scenario, not just a repeated call: wrote once with `idempotency_key` set (real hash change confirmed), then retried with the **same, now-stale** `document_hash` the original caller would still have (having never learned the new one) under the same key — the retry returned the identical cached success, touching WordPress not at all. A control call with the same stale hash but *no* `idempotency_key` was confirmed to genuinely hit the `409` CAS refusal, proving the replay path is what actually prevented that failure, not a coincidence. `list_changes` confirmed exactly one ledger row existed after both calls — the write really only happened once.

### 7.3 `get_page_structure` / `get_element` / `find_elements`

`find_elements` returns enough per match to skip a follow-up `get_element` in the common case — otherwise the model pays one round trip per match. `get_element` is for full native settings.

All three return the element IDs and the `document_hash` that `edit_elements` consumes, and IDs are stable across saves.

### 7.4 `render_preview` / `compare_to_reference`

```
render_preview:       { post_id, breakpoint?, element_id?, return_image?: false } → { resource_link | image, summary }
compare_to_reference: { post_id, reference_id, breakpoint? } → { score, regions[] }
```

Defaults to a signed `resource_link`, inline image only on request. One image per call. Region-scoped capture via `element_id`. Captures `.elementor-{post_id}`. Never returns SVG.

`compare_to_reference` returns **numbers** — ranked regions with bounding boxes — not pictures.

### 7.5 `publish_draft`

```
in:  { post_id, confirmation_token? }
out: { published: bool, status: string, url? } | { published: false, status: "pending", message, approval_url }
```

Called without a token, it returns `pending` plus instructions for obtaining one out-of-band. The token is bound to `(site, post_id, content_hash)`, single-use, minutes-long TTL, and **obtainable only through a channel the model cannot write to**. A boolean argument is not a human gate.

**Implemented (EMCP-047). D3 resolved: the out-of-band channel is a wp-admin approval screen**, not Slack/email — `plugin/src/Admin/PublishApprovalPage.php`, a `Tools → EMCP Publish Approval` page taking `?post_id=`. Chosen specifically because it needs no new external service or credentials and satisfies "a channel the model cannot write to" for free: this server authenticates to WordPress only via an Application Password over the REST API (`Capabilities::can_read()`, every other `emcp/v1` route's permission callback, explicitly *rejects* cookie authentication) — it holds no cookie session and no WordPress nonce, so it cannot load this page, submit its form, or read the token back. Live-verified: an unauthenticated request to the approval page 302-redirects to `wp-login.php` rather than showing anything.

`POST /documents/{id}/publish` — `{ confirmation_token? }`. Requires `current_user_can( 'publish_post', $post_id )`, a stronger gate than every other write route in this controller (`edit_post`). Two genuinely different operations depending on whether the post is currently published (`PublishService::resolve_current_state()`/`promote()`, mirroring EMCP-045's own source resolution): a **new, never-published** post gets a normal `wp_publish_post()` draft→publish transition (there's no separate autosave to promote — a non-published post's writes already land on the parent, EMCP-045's invariant); an **already-published** post with pending `edit_elements` autosave edits gets those promoted onto the parent via `Plugin::$instance->db->copy_elementor_meta()` (autosave → parent — the same call EMCP-045 already proved correct in the reverse direction).

The approval token itself (`ApprovalTokenSigner`/`ApprovalTokenService`, `plugin/src/Approvals/`) mirrors `PreviewTokenService`'s established shape closely (HMAC-signed payload + a nonce table for single-use/revocation, only the token's SHA-256 hash ever stored) with one real addition: the signed payload carries `chash`, the target content's hash *at issuance time*, and `redeem()` refuses the token outright (`409 emcp_approval_content_changed`) if the content has changed since — the same compare-and-swap discipline `document_hash` gives `edit_elements`, applied to approval instead of the write itself. A completely separate HMAC secret from `PreviewTokenService`'s (`emcp_approval_token_secret` vs. `emcp_preview_token_secret`) and a different `aud` claim (`'publish'` vs. `'renderer'`) mean the two token types are never accidentally interchangeable.

Live-verified end to end through the real `/mcp` endpoint, including a genuine wp-admin cookie login (not just the REST API): both branches — a brand-new draft promoted to `publish`, and an already-published page's pending autosave edit promoted onto the parent (parent's `document_hash` afterward matched the autosave's exactly) — single-use enforcement (a reused token is rejected, `emcp_approval_token_invalid`), and the content-hash binding genuinely rejecting a token whose target content changed after approval was issued (confirmed both the false-negative case — content unchanged, token still valid — and the real rejection when content had actually changed).

Deliberately **not** ledgered against `rollback`'s restore mechanism doing anything useful with title/template changes the way `update_page` also isn't (§6.9) — but `publish_draft` **does** write a ledger entry (`redactedArgs: { post_id }`, `approvalTokenRef`: a SHA-256 of the token, never the raw value, and a pre-promotion snapshot pointer) since a promoted/published change is exactly the kind of thing §7.6's own noted follow-up ("the same out-of-band approval as `publish_draft`" for rolling back a published post) will eventually need to act on.

### 7.6 `list_changes` / `rollback`

```
list_changes: { limit? }                → { changes[], count }
rollback:     { change_ids[] (max 20) } → { results[] }
```

`list_changes` reads the ledger index (Node/Postgres, EMCP-013/038), most recent first, scoped to exactly one `site_id` — never a parameter a caller can widen. `rollback` reverts each given change to its recorded snapshot (`snapshot_pointer`), each processed independently so one failure doesn't block the rest. Bounded to 20 `change_ids` per call (solution.md §8: "max N changes"). Every restore is preceded by a fresh snapshot of the post's *current* state — a bad rollback is itself rollback-able. A change whose target post is currently published is refused outright: solution.md §8 requires "the same out-of-band approval as `publish_draft`" — that mechanism exists now (§7.5, EMCP-047) but `rollback` doesn't yet accept a `confirmation_token`, a deliberate scope boundary, so it still fails closed rather than allowing an unguarded rollback of live content.

`rollback` derives the target post id from `redacted_args.post_id` on the ledger row — the ledger schema itself has no dedicated `post_id` column (§10). Any mutating tool whose changes should be rollback-able must include `post_id` in its ledger allowlist (`server/src/ledger/allowlists.ts`), or its changes can be listed but never rolled back.

### 7.7 `create_page` / `update_page`

```
create_page: { title, post_type?, page_template?, idempotency_key? } → { id, status, type, link, edit_url, page_template, document_hash }
update_page: { post_id, title?, page_template? }                    → { id, title, page_template, status, link }
```

**Implemented (EMCP-046).** `create_page` always creates a `draft` (§6.9) — there is no `status` argument. `post_type` defaults to `"page"` and is validated against the real post-type registry (`post_type_supports( $type, 'elementor' )`), never a hardcoded list. `page_template` defaults to `"default"`; the exact set of other valid values is site-specific (whatever `wp_get_theme()->get_page_templates()` returns) and is enforced server-side, not documented as a fixed enum here, since it can differ per theme/Elementor version. Unlike `edit_elements`, a repeat `create_page` call under the same arguments is a **real duplicate** (two separate pages), not a no-op — so `idempotency_key` matters more here, reusing the exact mechanism EMCP-044 built (`(subject, site, key)`-scoped, `onConflictDoNothing`): a retried call under the same key returns the original page's result instead of creating a second one, live-verified via `list_pages` showing only one page after two calls under the same key.

`update_page` changes only a page's **attributes** (title, Elementor page template), never its content — that's `edit_elements`'s job. No `document_hash` argument: title/template aren't part of the element tree or its hash, so there's nothing to compare-and-swap. Takes effect immediately regardless of publish state — unlike `edit_elements` (EMCP-045), this never branches to an autosave, since a page template genuinely has no "draft" version the way element content does (§6.9). At least one of `title`/`page_template` is required; a call with neither is refused before any WordPress call.

Neither tool writes a ledger entry or is rollback-able (§6.9's reasoning: `create_page` has nothing to roll back to, and `rollback`'s restore mechanism doesn't touch title/template at all).

### 7.8 `list_templates` / `save_as_template`

```
list_templates:   {} → { templates: [{id, name, source_post_id, created_at}], count }
save_as_template: { post_id, name, source?, idempotency_key? } → { id, name, created_at, diagnostics[] }
```

**Implemented (EMCP-060).** `save_as_template` reads a page's native elements (`GET /documents/{id}`, `source` defaulting to `"parent"`), `decompile()`s them (EMCP-054) into a portable DSL spec, and stores that spec via `POST /templates` (§6.10) — never the frozen native JSON, so the template stays generation-agnostic (§4). `decompile()` never hard-fails, so this tool always succeeds at saving *something*; `diagnostics` reports anything that fell back to `raw`/`widget` rather than a native mapping, the same posture §4 already documents for decompiling in general.

`buildSiteProfile()` (`server/src/tools/siteProfile.ts`, EMCP-055) gained a `requireEmissionGeneration` parameter for this task — `save_as_template` calls it with `false`, since `decompile()` never reads `siteProfile.generation` at all (each node's generation comes from its own native shape via `detectNodeGeneration()`) and works on `legacy` content by design. `validate_page_spec`/`apply_page_spec` still call it with the default `true`, since **their** direction (`compile()`) genuinely cannot target a `legacy`-default site.

Neither tool writes a ledger entry (mirroring `create_page`'s own reasoning, §6.9: a new template has no prior state to roll back to). `idempotency_key` on `save_as_template` follows the same pattern EMCP-044/046 established: a retried call under the same key returns the original template rather than saving a duplicate.

Live-verified end to end on `wp-v4-pro`: a genuine round trip — `apply_page_spec` compiled a heading and a button onto a real page, `save_as_template` decompiled that page's actual persisted native elements back into a clean spec (heading text/level and button text preserved; the button's `link`, never written in the first place per its own `NATIVENESS_LOW` warning, correctly absent from the round-tripped spec too, not silently fabricated) — confirmed by reading the stored `spec` column directly, not just trusting the tool's own response. `list_templates` reflected both saved templates with real `source_post_id`s.

### 7.9 `apply_template`

```
in:  { post_id, template_id, document_hash, dry_run?, idempotency_key? }
out: { document_hash, diagnostics[], nativeness, raw_ratio, applied: bool, path: "draft"|"autosave" }
```

**Implemented (EMCP-061).** Identical output contract to `apply_page_spec` (§7.1) by design — same operation, spec sourced from a stored template (`GET /templates/{id}`, a new route this task added since §6.10's original scope only needed list+save) instead of an inline argument. `server/src/tools/applyCompiledSpec.ts` is the shared write pipeline both tools call: document fetch/autosave-source-resolution, `compile()`, the `dry_run` short-circuit, snapshot/write/cache-invalidate, ledger, idempotency — extracted here rather than duplicated, since the two tools' only real difference is where `spec` comes from. `apply_page_spec.ts`/`apply_template.ts` are now thin: each validates its own input shape, resolves a `Spec`, and hands off.

**"Regenerates element IDs" (prd.md) needed no new code** — `compile()` already generates fresh, whole-tree-unique ids on every call (`generateUniqueId()`, EMCP-049), so applying the same template twice (to the same page or different ones) produces two different id sets simply because each is an independent `compile()` invocation, never a copy of a prior result. Confirmed, not assumed: a unit test applies the same template twice and asserts the resulting element ids differ; live-verified too (see below).

Live-verified end to end on `wp-v4-pro`: a template saved from one page's real content (§7.8's own round-trip test) applied cleanly to a *different*, freshly created draft page — the target page's content matched the template exactly (heading/button text, real `e-heading`/`e-button` widget types) with genuinely fresh element ids (`8b1a1e6`/`b4de8ce`, distinct from the source page's own `43b1180`/`dbe4601`-style ids from earlier in the same session); an unknown `template_id` was refused with a real `404`-derived message before the target document was ever read (`getDocument` confirmed never called); `list_changes` showed a real `apply_template` ledger row with the correct `post_id`, proving the shared write pipeline's ledger/snapshot/idempotency machinery works identically through this second caller, not just through `apply_page_spec`.

### 7.10 Cross-sandbox portability (EMCP-062)

**Verified live across both real sandboxes, no new code needed** — the mechanisms this section exercises (`WIDGET_NOT_AVAILABLE`, `dry_run`'s no-write guarantee, generation-agnostic DSL node types) were already built and unit-tested by EMCP-055/060/061; this task's job was confirming they hold against a second, genuinely different real site, not `wp-v4-pro` mocked as if it were `wp-v3-free`.

**Architectural clarification found while testing, not a bug:** "one connector = one site" (solution.md §3) means a single running server instance only ever talks to one `WP_BASE_URL`. Templates are stored site-side (§6.10) — `wp-v4-pro`'s `emcp_templates` table and `wp-v3-free`'s are two entirely separate tables. `apply_template` therefore cannot move a template *between* sites by `template_id` alone within one session; genuine cross-site portability happens at the **spec** level — a caller reads a template's `spec` via `GET /templates/{id}` on site A's connector, then either re-saves it via `POST /templates` on site B's connector (to `apply_template` it there by id) or passes it straight into `apply_page_spec`/`validate_page_spec` with `dry_run` on site B directly. This is a real, previously-undocumented boundary of the design — recorded here rather than left implicit.

Reproduced live using a second `mcp` container instance pointed at `wp-v3-free` (`WP_BASE_URL`/`WP_AUTH_APP_PASSWORD` overridden via `docker compose run`) alongside the existing `wp-v4-pro`-pointed one, confirming both `generation_default`/`pro_tier` genuinely differed (`v4`/`essential`-tier features present vs. `v3`/`free`) before trusting any result:

- A spec using the `widget` escape rung with a genuinely v4-only widget (`e-heading`, absent from `wp-v3-free`'s real 141-widget registry — confirmed via `list_widgets`, only `e-component` among `e-`-prefixed names exists there) was refused by `validate_page_spec` with `WIDGET_NOT_AVAILABLE`, naming the widget and listing the site's real `allowed` registry.
- The same spec through `apply_page_spec`'s `dry_run: true` against a real `wp-v3-free` draft page was refused identically (`applied: false`) — confirmed via a follow-up `get_page_structure` that the page's `document_hash` and `elements` were completely unchanged, proving `dry_run` genuinely never reached the write path, not just that it reported `applied: false`.
- **The positive case, not just the negative one:** the *exact* spec `save_as_template` had decompiled from a real `wp-v4-pro` page (§7.8, using the DSL's generation-agnostic `heading`/`button` node types, not the `widget` escape rung) validated cleanly (`valid: true`, `nativeness: 1`) against `wp-v3-free`, and — applied for real — produced native `elType: "widget", widgetType: "heading"`/`"button"` elements (`generation: "v3"`, confirmed via `get_page_structure`), the site's real legacy widgets, not `e-heading`/`e-button`. Same content, correctly re-targeted per-site by `compile()`'s own generation dispatch — this is the actual value cross-sandbox portability is for, and it works.

### 7.11 `upload_media` / `list_media`

```
list_media:   {} → { media: [{id, url, filename, mime_type, created_at}] }
upload_media: { url, filename? } → { id, url, filename, mime_type, width, height }
```

**Implemented (EMCP-063).** `upload_media` is the URL half of D1's resolution — the only ingestion shape an MCP tool input (JSON) can carry. `list_media` is deliberately also how a human's **out-of-band** upload (a direct multipart `POST /media`, §6.11) becomes visible to the model — there is no separate "notify the model of an out-of-band upload" mechanism; `list_media` already shows every attachment regardless of how it arrived.

Every real security control (content-derived MIME sniffing, category-based denial, SSRF-hardened URL fetch with per-redirect revalidation, pixel-dimension cap, EXIF strip, unique filenames) lives plugin-side (`MediaService`, §6.11) — this tool layer is thin, matching every other read/write split this project has already established.

Live-verified adversarially on `wp-v4-pro` — see §6.11 for the full list (SSRF across four address classes including mid-redirect, `file://` scheme rejection, a `<script>`-carrying SVG rejected despite a spoofed `.jpg` extension and `image/jpeg` `Content-Type`, and successful uploads via both the URL and direct-multipart paths, confirmed visible together in one `list_media` call).

### 7.12 `upload_reference_design`

```
upload_reference_design: { url? } → { reference_id, resource_link? } | { reference_id, upload_url, message }
```

**Implemented (EMCP-064), the second half of D1's resolution.** Unlike `upload_media`, a reference design never touches WordPress — it lives in the same S3-compatible object storage `render_preview` already uses (Blueprints.md §11.2), under a `reference-designs/` key prefix, since it is a comparison artifact for `extract_design_tokens`/`compare_to_reference` (not yet built), never content inserted into a page. `server/src/storage/objectStorage.ts` gained `uploadReferenceDesign()` (multi-day TTL, unlike a preview screenshot's hour) and `presignReferenceDesignUpload()`.

**Two modes in one tool, mirroring `publish_draft`'s own established shape** ("call without a token, get instructions for the out-of-band path instead"): given `url`, the server fetches directly; omitted, the tool returns a presigned **PUT** URL — the S3-world equivalent of `upload_media`'s direct-multipart-to-WordPress path — plus a `reference_id` (the object key) allocated up front, so the caller can hand it to a later `compare_to_reference` call without a second round trip once the human's upload completes.

**The URL-fetch security pipeline is reimplemented in TypeScript** (`server/src/ingestion/safeFetch.ts`, `sniffMime.ts`), not shared with `MediaService`'s PHP, since this ingestion path is Node/MinIO-only and never reaches the plugin. Same policy as EMCP-063's PHP version: `http(s)`-only scheme, a manual per-hop redirect loop with `redirect: 'manual'` and independent re-validation of every hop's resolved IP against RFC1918/loopback/link-local/reserved ranges (the TypeScript equivalent of PHP's `FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE`, hand-enumerated since Node has no built-in for it), and content-derived MIME detection — magic-byte signatures for PNG/JPEG/GIF/WEBP, deny-by-default for everything else (no `finfo` equivalent ships with Node, so recognized-format allowlisting stands in for it, achieving the same "not extension-based" property).

**The out-of-band path is deliberately unvalidated — a real, documented limitation, not an oversight.** A presigned PUT goes straight from the uploader to MinIO; nothing server-side ever sees the bytes before they're stored, so none of the URL path's content checks can run. Whatever eventually reads a `reference-designs/` object back (`extract_design_tokens`) must treat every object there as untrusted input regardless of which ingestion path produced it.

Live-verified end to end, adversarially, on the real MinIO instance: a real image fetched through a URL was sniffed, stored, and its presigned `resource_link` independently confirmed fetchable (200, correct content type and size) outside the MCP call entirely; the SSRF guard blocked the cloud-metadata link-local address identically to EMCP-063's PHP version; non-image content (a real HTML response) was rejected by content sniffing, not URL/extension inspection; the out-of-band path was exercised for real — a presigned PUT URL was used to `PUT` real image bytes directly (no MCP call involved in the upload itself), and the resulting object was independently confirmed to exist via the MinIO client (`mc stat`), including the real, documented observation that its `Content-Type` metadata came from curl's own default rather than anything this project validated — direct evidence of the "unvalidated out-of-band path" limitation stated above, not just an assertion of it.

### 7.13 `extract_design_tokens`

```
extract_design_tokens: { reference_id } → { colors: [{hex, matched_token: {id, title, delta_e} | null}] }
```

**Implemented (EMCP-065).** Colour-only, deliberately — prd.md's own wording for this task ("perceptual colour distance... reconciles against existing kit tokens") says nothing about typography, and extracting font identity from a raster image is a different, much larger problem (OCR plus font recognition) this task does not attempt.

Reads the reference design back from object storage (`downloadObject()`, a new function — the first real reader of anything this project has written to object storage), extracts its dominant colours by downsample-and-histogram (`server/src/ingestion/extractColors.ts`, via `sharp` — the first image-decoding dependency this project has needed), then reconciles each against the site's real kit colours (`get_global_styles`, EMCP-029) using **CIE76 delta-E in CIE L\*a\*b\* space**, not hex/RGB string comparison — Lab space is designed so Euclidean distance within it tracks human colour perception, which raw RGB distance does not (`server/src/ingestion/colorDistance.ts`). A match threshold of 10 (a commonly cited "reads as the same colour family" delta-E boundary) decides whether an extracted colour is reported as matching an existing kit token or as new.

**Re-sniffs the downloaded bytes before decoding them as an image** (`sniffImageMimeType()`, reused from EMCP-064) — `upload_reference_design`'s out-of-band path is documented as completely unvalidated (§7.12), so this is the enforcement point that actually makes that documented limitation harmless rather than just noted: anything non-image that landed in `reference-designs/` via the unvalidated path is refused here, before `sharp` ever touches it.

Live-verified end to end, including the security boundary, not just the happy path: a real fetched reference design's dominant colours were extracted and correctly reported as not matching the live kit's actual colours (a genuinely different palette); a solid-colour test image built to be *exactly* the kit's real `Primary` (`#6EC1E4`) was uploaded via the out-of-band path and correctly matched with `delta_e: 0`; and a malicious SVG payload (the same `<script>`-carrying one EMCP-063/064 used) was uploaded via the unvalidated out-of-band path directly to MinIO, then `extract_design_tokens` was called against it and correctly refused it via content sniffing — proving the two tasks' documented gap (out-of-band ingestion is unvalidated) and its intended mitigation (every read re-validates) both work together as designed, not just individually.

---

## 8. Error taxonomy

### 8.1 Channels

| Class | Channel |
|---|---|
| Validation, missing widget, stale hash, post locked, capability denial, nativeness warning, unresolved token | `isError: true` |
| Unknown tool, arguments failing `inputSchema`, internal error | JSON-RPC error |
| Expired / insufficient token | **HTTP 401/403 + `WWW-Authenticate`** |

Auth failures returned as `isError` never trigger refresh — the connector then appears permanently broken.

### 8.2 Codes

`TOKEN_UNRESOLVED`, `WIDGET_NOT_AVAILABLE`, `CONTROL_NOT_FOUND`, `CONTROL_CONDITION_UNMET`, `BREAKPOINT_UNKNOWN`, `DSL_VERSION_UNSUPPORTED`, `RAW_DENIED_KEY`, `RAW_SANITISED`, `HASH_STALE`, `POST_LOCKED`, `WORKING_SET_VIOLATION`, `APPROVAL_REQUIRED`, `NATIVENESS_LOW` (warning), `GENERATION_MISMATCH`.

**Added (EMCP-048), grammar-layer codes `parseSpec()` (`server/src/dsl/validate.ts`) actually emits, none of which fit an existing code cleanly:** `SPEC_MALFORMED` (root/node shape wrong — not an object, missing required structural field, wrong primitive type), `NODE_TYPE_UNKNOWN` (a node's `type` isn't one of §2.3's set — carries the real set as `allowed`), `NODE_FIELD_MISSING` (a node type's own required field, per §2.3's table, is absent), `REASON_REQUIRED` (§2.8's "`reason` is mandatory" rule, for both `raw` and `html` nodes, in one place rather than two separately-drifting checks).

**Added (EMCP-049):** `EMISSION_NOT_IMPLEMENTED` — `compile()` (`server/src/dsl/compile.ts`) emits this for a node type with no registered emitter for the target `siteProfile.generation`. Real today for every node type except `widget` (§3.2's own "passthrough" case, the one this core task implements) — expected to disappear node-type-by-node-type as EMCP-050/051 register real v3/v4 emitters, not a bug to fix in this task.

Every code carries `path`, `message`, `allowed[]` where applicable, and `suggestion`.

### 8.3 Sanitisation rules

Applied to `raw` values, `html` node content, and `import_html` output if that ever lands:

- Reject `<script>`, `<iframe>`, `<object>`, `<embed>`
- Reject `on*` attributes
- Reject `javascript:`, `vbscript:`, and top-level `data:` URLs
- Reject reserved keys (§2.8)
- Flag any node introducing an external URL for human review

Note that Elementor additionally applies `wp_kses_post()` because our WP user lacks `unfiltered_html`. Our sanitiser runs **first and independently** — defence in depth, and it produces a legible error instead of silent stripping.

---

## 9. Fixtures and verification

### 9.1 The fixture set

Captured from **real Elementor** in phase 0, each carrying a provenance header (Elementor version, plugin list, capture date). **Hash-checked and agent-immutable** — an agent told "make the tests pass" will otherwise regenerate a fixture from its own compiler output, greening the suite while verifying only that the compiler agrees with itself.

| Fixture | Covers |
|---|---|
| `legacy-section-column` | Pre-container structure |
| `v3-container` | Modern flexbox |
| `v4-atomic` | `e-flexbox` / `e-grid`, nested typed props, local `styles` |
| `mixed-v3-v4` | Per-node detection |
| `mixed-legacy-v3` | Containers added to a legacy page |
| `nested-widget` | Nested Tabs — widget with `elements` children |
| `pro-globals-dynamic` | `__globals__` / `__dynamic__` preservation |
| `unicode-roundtrip` | Em-dashes, curly quotes, Arabic/CJK through snapshot → rollback → re-read |
| `responsive-widescreen` | `min-width` inversion |
| `deep-nested` | Depth limiting and truncation |

### 9.2 The registry snapshot

Validation's ground truth lives in PHP. Rather than round-tripping per validation or trusting an untested cache:

1. `GET /registry/snapshot` returns the full curated schema.
2. One snapshot per sandbox configuration is committed, with provenance.
3. A CI job re-pulls and diffs, **failing loudly on drift**.

Roughly two days of work, and it is what makes the compiler genuinely testable offline.

### 9.3 Harness split

- `verify:unit` — no network. Compiler, decompiler, digest, validation, sanitisation, against fixtures and the registry snapshot.
- `verify:live` — requires a sandbox. Write paths, cache invalidation, preview tokens, locks, rendering.

Both emit machine-readable pass/fail. **`ralphloop.md` must state that green unit tests do not imply correct live behaviour.**

---

## 10. Data shapes

**Site record:** slug (unguessable), URL, generation default, credentials ref, environment (`sandbox` | `client`), plugin version, min supported version.

**Grant:** `(oauth_subject, site_slug, scopes[])`. No fallback credential; a missing grant is 403 before any outbound request.

**Ledger index row (Node):** id, site, subject, tool, redacted args, correlation id, timestamp, snapshot pointer, `raw_ratio`, nativeness, approval token ref. Args are **allowlisted in**, not denylisted out — `server/src/ledger/redact.ts` (EMCP-038), driven by a per-tool allowlist (`server/src/ledger/allowlists.ts`) kept deliberately separate from `ToolDescriptor` so it can never leak into the public `tools/list` wire response. `server/src/ledger/writer.ts` is the one function that writes to `ledgerIndex` (EMCP-013's schema) — same relationship `registry/admin.ts`'s `createSite` has to `sites`.

**Wired into a live tool-call path for the first time in EMCP-043** — `edit_elements` is the first real mutating tool, and its handler writes a real ledger row per call: `site_id` from `resolveCurrentSite()` (matching `WP_BASE_URL` against the registered `wp-v4-pro` row, EMCP-039), `correlation_id` from the actual Fastify request id (threaded from `route.ts` through `registry.ts`'s `dispatch()`/`callTool()` down to `ToolImplementation.handler`'s new optional second parameter — a real gap found and closed in the same pass: solution.md's "correlation IDs generated in Node... echoed in every result and error" had no path to the handler before this). `subject` is a fixed placeholder (`LOCAL_SUBJECT = 'local-header-auth'`) — this server's local dev auth is one shared header token with no per-caller identity; a real subject arrives with OAuth (D2). A ledger-write failure never fails a call whose WordPress write already succeeded, since content already changed and reporting an error would invite an unwanted retry (no idempotency layer exists yet, EMCP-044).

**Snapshot (WordPress):** prior `_elementor_data`, which path it captured (parent or autosave), meta, hash. Stored site-side so content stays with the site and rollback survives a Node outage.

**Cache keys** include the site slug in every path, prefix and index. Post ID 42 exists on every WordPress site.

---

## 11. Stack and infrastructure

### 11.1 Scope boundary

**This is an Elementor MCP, not a WordPress MCP.** It covers pages, media, and (later) menus — only as much WordPress as Elementor work requires. Site administration (users, roles, plugins, themes, settings, taxonomies, comments, arbitrary post types) is **out of scope** and stays out.

The composition model is that MCP clients connect to several servers at once: a general WordPress MCP handles administration, this one handles Elementor. Building WP admin tooling here would mean maintaining a worse version of something that already exists.

**Consequence to design for:** if both servers are connected, tool counts add up and some tools overlap by name (`create_page` exists in both). Every tool description must state the boundary explicitly — *"use this for Elementor-built pages"* — or model selection degrades. Revisit after real usage if the team hits WordPress-level gaps often.

### 11.2 Stack

| Layer | Choice | Note |
|---|---|---|
| MCP server | TypeScript (strict) + `@modelcontextprotocol/sdk` | |
| HTTP | Fastify | Native JSON Schema handling matches the tool schemas |
| Validation | Zod + `zod-to-json-schema` | One source for tool schemas and runtime validation |
| Renderer | Playwright + headless Chromium | Separate service, containerized |
| Plugin | PHP 8.1+, Composer, PSR-4 | |
| Database | PostgreSQL | §11.3 |
| Migrations | Drizzle | TypeScript-first, SQL-shaped |
| Object storage | S3-compatible | Screenshots, reference designs |
| Image decoding | `sharp` | Added EMCP-065, `extract_design_tokens` — dominant-colour extraction from reference designs |
| Tests | Vitest (Node), PHPUnit (plugin) | Split per §9.3 |

### 11.3 What the database holds

Smaller than expected, because snapshot payloads live in WordPress (`solution.md` §3):

- Site registry, grants, encrypted credential references
- Ledger **index** rows — redacted args, correlation IDs, snapshot pointers
- Idempotency keys, approval tokens, preview-token nonces

PostgreSQL over SQLite because the commercialization path wants row-level security for tenant isolation, and retrofitting that is worse than starting with it. JSONB suits the redacted-args column.

Blobs never go in Postgres. The credential KEK lives in a KMS that **the renderer has no grant to** (`solution.md` §9.5).

Deferred but likely: a job queue (BullMQ + Redis) once renders and large builds outgrow request timeouts. The Tasks extension may cover v1 without it.

### 11.4 Development environment — Docker Compose

| Service | Purpose |
|---|---|
| `wp-v4-pro` | WordPress + Elementor Pro, **V4/atomic default** |
| `wp-v3-free` | WordPress + Elementor Free, V3 containers, carrying legacy fixture pages |
| `db-wp` | MariaDB for both WordPress instances |
| `mcp` | Node MCP server |
| `db` | PostgreSQL |
| `renderer` | Playwright service |
| `minio` | S3-compatible object storage |

Two WordPress containers, not one — they cover both real forks (V4-vs-V3 and Pro-vs-Free) with two services, and they are the sandboxes `solution.md` §16 requires.

**Segment the renderer in development too.** Put it on its own Compose network with no route to `db` or the credential store. The isolation requirement is a production control, but making it habitual locally means the topology is exercised continuously rather than discovered at deployment.

Reset tooling is part of this: database plus uploads plus `uploads/elementor/css/`, scripted, unable to target anything but the sandbox containers.

Auth locally is **header-based via Claude Code**. Claude.ai and OAuth only run against a deployed environment.

### 11.5 Production hosting — open

Docker Compose is the development answer. Production is not decided, and it determines three things already specified as requirements: the KMS backing the credential KEK, real network segmentation for the renderer, and public TLS reachable from Anthropic's egress range. Decide before phase 7; phases 0–6 run entirely on the local Compose stack.

---

## 12. Deliberately unresolved

These need a decision or a measurement before the phases that depend on them. None block phase 0.

1. **V4 authoring size.** The typed-prop and local-`styles` emission path is a timeboxed spike in phase 2. Until it runs, the v4 half of §3.2 is a design, not an estimate.
2. **Reference design ingestion.** MCP tool inputs are JSON and a model cannot re-emit an image it was shown, so a mockup pasted into chat cannot reach the server. Until URL or out-of-band upload is chosen, `compare_to_reference` has no input and visual criteria stay human-judged.
3. **IdP selection**, against `solution.md` §9.3's criteria. Gates phase 7, and procurement lead time starts now.
4. **Per-element `version` migration.** V4 nodes carry a schema version and we have no migration concept.
5. **Global classes and components as first-class DSL citizens.** v1 emits local styles only, which is sufficient to author V4 but does not participate in a site's existing V4 design system.
6. **DSL vs HTML authoring**, to be settled by measured head-to-head on fixture designs — nativeness and iteration count — not assertion.
