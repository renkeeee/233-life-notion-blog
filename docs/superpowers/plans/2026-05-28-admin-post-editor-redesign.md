# Admin Post Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the local post editor into a writing-first workspace with a focused writing canvas and a right-side article details rail.

**Architecture:** Keep `LocalPostEditor` as the owner of editor state and API calls. Restructure its JSX into semantic regions for the top bar, writing canvas, and article details rail, then update `app/app.css` to create the two-column desktop layout and one-column mobile layout. Preserve existing accessible labels and all save, publish, image upload, and busy-state behavior.

**Tech Stack:** React 19, React Router admin UI, MDXEditor, Vitest, Testing Library, vanilla CSS in `app/app.css`.

---

## File Structure

- Modify `tests/admin-ui.test.tsx`: Add layout assertions around the editor regions while keeping existing behavior tests intact.
- Modify `tests/admin-styles.test.ts`: Add CSS contract checks for the editor workspace, writing canvas, details rail, and mobile collapse.
- Modify `app/components/admin/LocalPostEditor.tsx`: Reorganize the render tree without changing API behavior.
- Modify `app/app.css`: Add the writing-first editor layout and responsive rules.

## Task 1: Lock the New Editor Layout in Tests

**Files:**
- Modify: `tests/admin-ui.test.tsx`

- [ ] **Step 1: Update the draft-opening test with region assertions**

In `tests/admin-ui.test.tsx`, inside `it("creates a local draft and opens the Markdown editor", ...)`, after:

```ts
await screen.findByRole("heading", { name: "New local post" });
```

add:

```ts
const writingCanvas = screen.getByRole("region", { name: "Writing canvas" });
const articleDetails = screen.getByRole("region", { name: "Article details" });

expect(within(writingCanvas).getByLabelText("Title")).toHaveValue(
	"Untitled draft",
);
expect(within(writingCanvas).getByLabelText("Markdown")).toBeTruthy();
expect(within(articleDetails).getByLabelText("Slug")).toBeTruthy();
expect(within(articleDetails).getByLabelText("Summary")).toBeTruthy();
expect(within(articleDetails).getByLabelText("Published at")).toBeTruthy();
expect(within(articleDetails).getByLabelText("Category")).toBeTruthy();
expect(within(articleDetails).getByLabelText("Tags")).toBeTruthy();
expect(within(articleDetails).getByLabelText("Enable comments")).toBeTruthy();
expect(within(articleDetails).getByRole("button", { name: "Save draft" })).toBeTruthy();
expect(within(articleDetails).getByRole("button", { name: "Publish" })).toBeTruthy();
```

Keep the existing global assertions for `screen.getByLabelText("Title")`, `screen.getByLabelText("Markdown")`, and `mdx-editor-plugins`.

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npx vitest run tests/admin-ui.test.tsx --testNamePattern "creates a local draft"
```

Expected: fail because `Writing canvas` and `Article details` regions do not exist yet.

- [ ] **Step 3: Do not change production code in this task**

Leave production files untouched until Task 2.

## Task 2: Restructure `LocalPostEditor` Markup

**Files:**
- Modify: `app/components/admin/LocalPostEditor.tsx`

- [ ] **Step 1: Add reusable action label constants**

Inside `LocalPostEditor`, immediately after `const busy = saving || publishing || uploading;`, add:

```ts
const saveLabel = saving ? "Saving..." : "Save draft";
const publishLabel = publishing ? "Publishing..." : "Publish";
const draftStateLabel = dirty ? "Unsaved changes" : `Status: ${draft.status}`;
```

- [ ] **Step 2: Replace the existing returned JSX with the new structure**

Replace the current `return (...)` body in `LocalPostEditor` with:

```tsx
return (
	<div className="admin-stack admin-local-post-editor">
		<header className="admin-editor-topbar">
			<button
				type="button"
				className="admin-secondary-button"
				disabled={busy}
				onClick={onBack}
			>
				Back
			</button>
			<div>
				<p className="admin-eyebrow">Local draft</p>
				<h2>New local post</h2>
				<p className="admin-editor-subtitle">{draftStateLabel}</p>
			</div>
			<div className="admin-editor-topbar-actions">
				<button type="button" disabled={busy} onClick={() => void saveDraft()}>
					{saveLabel}
				</button>
				<button type="button" disabled={busy} onClick={() => void publishDraft()}>
					{publishLabel}
				</button>
			</div>
		</header>

		<div className="admin-editor-workspace">
			<section
				className="admin-module admin-editor-writing"
				aria-labelledby="admin-editor-writing-heading"
			>
				<div className="admin-editor-section-heading">
					<div>
						<p className="admin-eyebrow">Writing canvas</p>
						<h3 id="admin-editor-writing-heading">Writing canvas</h3>
					</div>
					<label className="admin-upload-button">
						{uploading ? "Uploading..." : "Upload image"}
						<input
							aria-label="Upload image"
							type="file"
							accept="image/*"
							disabled={busy}
							onChange={(event) => {
								const file = event.currentTarget.files?.[0];
								event.currentTarget.value = "";
								if (file) {
									void uploadImage(file);
								}
							}}
						/>
					</label>
				</div>
				<form
					className="admin-form admin-editor-title-form"
					onSubmit={(event) => event.preventDefault()}
				>
					<label>
						Title
						<input
							disabled={busy}
							type="text"
							value={title}
							onChange={(event) => {
								setTitle(event.currentTarget.value);
								markDirty();
							}}
						/>
					</label>
				</form>
				<div className="admin-mdx-editor-shell">
					<MDXEditor
						ref={editorRef}
						markdown={markdown}
						plugins={editorPlugins}
						readOnly={busy}
						contentEditableClassName="admin-mdx-editor-content"
						onChange={(value) => {
							if (busy) {
								return;
							}
							setMarkdown(value);
							markDirty();
						}}
					/>
				</div>
			</section>

			<aside
				className="admin-module admin-editor-details"
				aria-labelledby="admin-editor-details-heading"
			>
				<div className="admin-editor-details-card">
					<div className="admin-section-heading compact">
						<div>
							<p className="admin-eyebrow">Article details</p>
							<h3 id="admin-editor-details-heading">Article details</h3>
						</div>
						<span className="admin-badge">{dirty ? "Unsaved" : draft.status}</span>
					</div>
					{error ? <p className="admin-error">{error}</p> : null}
					<p className="admin-note">{status}</p>
					<form
						className="admin-form admin-editor-details-form"
						onSubmit={(event) => event.preventDefault()}
					>
						<label>
							Slug
							<input
								disabled={busy}
								type="text"
								value={slug}
								onChange={(event) => {
									setSlug(event.currentTarget.value);
									markDirty();
								}}
							/>
						</label>
						<label>
							Summary
							<textarea
								disabled={busy}
								rows={5}
								value={excerpt}
								onChange={(event) => {
									setExcerpt(event.currentTarget.value);
									markDirty();
								}}
							/>
						</label>
						<label>
							Published at
							<input
								disabled={busy}
								type="datetime-local"
								value={publishedAt}
								onChange={(event) => {
									setPublishedAt(event.currentTarget.value);
									markDirty();
								}}
							/>
						</label>
						<label>
							Category
							<input
								disabled={busy}
								type="text"
								value={category}
								onChange={(event) => {
									setCategory(event.currentTarget.value);
									markDirty();
								}}
							/>
						</label>
						<label>
							Tags
							<input
								disabled={busy}
								type="text"
								value={tags}
								onChange={(event) => {
									setTags(event.currentTarget.value);
									markDirty();
								}}
							/>
						</label>
						<label className="admin-checkbox">
							<input
								disabled={busy}
								type="checkbox"
								checked={commentsEnabled}
								onChange={(event) => {
									setCommentsEnabled(event.currentTarget.checked);
									setCommentsEnabledTouched(true);
									markDirty();
								}}
							/>
							Enable comments
						</label>
					</form>
					<div className="admin-editor-rail-actions">
						<button type="button" disabled={busy} onClick={() => void saveDraft()}>
							{saveLabel}
						</button>
						<button type="button" disabled={busy} onClick={() => void publishDraft()}>
							{publishLabel}
						</button>
					</div>
				</div>
			</aside>
		</div>
	</div>
);
```

- [ ] **Step 3: Run targeted editor tests**

Run:

```bash
npx vitest run tests/admin-ui.test.tsx --testNamePattern "creates a local draft|saves a local draft|disables editing controls|uploads an image"
```

Expected: tests pass, or fail only because duplicate `Save draft` / `Publish` button names require scoped queries in existing tests.

- [ ] **Step 4: If duplicate button names break existing tests, scope only the affected clicks**

For tests that click `screen.getByRole("button", { name: "Save draft" })`, use the rail action when the test does not care which duplicate action is clicked:

```ts
fireEvent.click(
	within(screen.getByRole("region", { name: "Article details" })).getByRole(
		"button",
		{ name: "Save draft" },
	),
);
```

For publish tests, use:

```ts
fireEvent.click(
	within(screen.getByRole("region", { name: "Article details" })).getByRole(
		"button",
		{ name: "Publish" },
	),
);
```

## Task 3: Add Editor Layout CSS

**Files:**
- Modify: `app/app.css`
- Modify: `tests/admin-styles.test.ts`

- [ ] **Step 1: Add a failing CSS contract test**

In `tests/admin-styles.test.ts`, add this test inside `describe("admin styles", ...)`:

```ts
it("lays out the local post editor as a writing canvas with a details rail", () => {
	const workspaceRule = cssRule(".admin-editor-workspace");
	const writingRule = cssRule(".admin-editor-writing");
	const detailsRule = cssRule(".admin-editor-details");
	const detailsCardRule = cssRule(".admin-editor-details-card");
	const mobileRule = adminCss.match(
		/@media \\(max-width: 760px\\) \\{[\\s\\S]+?\\.admin-editor-workspace\\s*\\{([^}]+)\\}/,
	)?.[1] ?? "";

	expect(workspaceRule).toContain("display: grid");
	expect(workspaceRule).toContain("grid-template-columns: minmax(0, 1.75fr) minmax(300px, 0.7fr)");
	expect(writingRule).toContain("min-width: 0");
	expect(detailsRule).toContain("min-width: 0");
	expect(detailsCardRule).toContain("position: sticky");
	expect(mobileRule).toContain("grid-template-columns: 1fr");
});
```

- [ ] **Step 2: Run the CSS contract test and verify it fails**

Run:

```bash
npx vitest run tests/admin-styles.test.ts --testNamePattern "local post editor"
```

Expected: fail because the new selectors are not styled yet.

- [ ] **Step 3: Replace the old editor CSS block**

In `app/app.css`, replace the current editor rules from `.admin-local-post-editor` through `.admin-editor-actions` with:

```css
.admin-local-post-editor {
	max-width: 1280px;
}

.admin-editor-topbar {
	align-items: center;
	border: 1px solid var(--admin-line-soft);
	border-radius: 8px;
	background: var(--admin-card);
	display: grid;
	gap: 14px;
	grid-template-columns: auto minmax(0, 1fr) auto;
	padding: 14px;
}

.admin-editor-topbar h2 {
	color: var(--admin-ink);
	margin: 0;
}

.admin-editor-subtitle {
	color: var(--admin-muted);
	font-size: 0.88rem;
	font-weight: 650;
	margin: 6px 0 0;
}

.admin-editor-topbar-actions,
.admin-editor-rail-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	justify-content: flex-end;
}

.admin-editor-workspace {
	align-items: start;
	display: grid;
	gap: 16px;
	grid-template-columns: minmax(0, 1.75fr) minmax(300px, 0.7fr);
}

.admin-editor-writing,
.admin-editor-details {
	min-width: 0;
}

.admin-editor-writing {
	display: grid;
	gap: 14px;
}

.admin-editor-section-heading {
	align-items: center;
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	justify-content: space-between;
}

.admin-editor-section-heading h3,
.admin-editor-details h3 {
	color: var(--admin-ink);
	margin: 0;
}

.admin-editor-title-form {
	gap: 0;
}

.admin-editor-details-card {
	display: grid;
	gap: 14px;
	position: sticky;
	top: 24px;
}

.admin-editor-details-form {
	gap: 12px;
}

.admin-editor-details-form textarea {
	min-height: 112px;
}

.admin-upload-button {
	align-items: center;
	background: var(--admin-ink);
	border-radius: 6px;
	color: #ffffff;
	cursor: pointer;
	display: inline-flex;
	font-size: 0.86rem;
	font-weight: 750;
	justify-content: center;
	min-height: 38px;
	padding: 8px 14px;
}

.admin-upload-button input {
	clip: rect(0 0 0 0);
	height: 1px;
	overflow: hidden;
	position: absolute;
	white-space: nowrap;
	width: 1px;
}

.admin-mdx-editor-shell {
	border: 1px solid var(--admin-line);
	border-radius: 8px;
	background: var(--admin-card);
	overflow: hidden;
}

.admin-mdx-editor-shell .mdxeditor {
	min-height: 520px;
}

.admin-mdx-editor-content {
	min-height: 460px;
	padding: 18px;
}
```

- [ ] **Step 4: Replace old mobile editor responsive rules**

In the existing `@media (max-width: 760px)` block, replace the old `.admin-editor-actions, .admin-editor-toolbar` entry with:

```css
.admin-editor-topbar,
.admin-editor-section-heading,
.admin-editor-topbar-actions,
.admin-editor-rail-actions {
	justify-content: flex-start;
	width: 100%;
}
```

Also add `.admin-editor-workspace` to the one-column grid list:

```css
.admin-form.inline,
.admin-post-filters,
.admin-album-command-grid,
.admin-album-filters,
.admin-album-workspace,
.admin-album-tools,
.admin-inline-form,
.admin-field-grid,
.admin-editor-workspace,
.admin-overview-grid {
	grid-template-columns: 1fr;
}
```

Finally add:

```css
.admin-editor-topbar {
	grid-template-columns: 1fr;
}

.admin-editor-details-card {
	position: static;
}
```

- [ ] **Step 5: Run CSS tests**

Run:

```bash
npx vitest run tests/admin-styles.test.ts
```

Expected: all style tests pass.

## Task 4: Update Interaction Tests for Duplicate Actions

**Files:**
- Modify: `tests/admin-ui.test.tsx`

- [ ] **Step 1: Add a helper for editor rail actions**

Inside `describe("PostStatusTable", ...)`, below `openPostManagement`, add:

```ts
function editorDetailsRegion(): HTMLElement {
	return screen.getByRole("region", { name: "Article details" });
}

function clickEditorRailButton(name: string) {
	fireEvent.click(within(editorDetailsRegion()).getByRole("button", { name }));
}
```

- [ ] **Step 2: Replace editor save clicks with the helper**

In editor tests, replace:

```ts
fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
```

with:

```ts
clickEditorRailButton("Save draft");
```

Only replace occurrences inside editor-focused tests where a draft is open. Do not replace save buttons in unrelated comment/settings tests.

- [ ] **Step 3: Replace editor publish clicks with the helper**

In editor publish tests, replace:

```ts
fireEvent.click(screen.getByRole("button", { name: "Publish" }));
```

with:

```ts
clickEditorRailButton("Publish");
```

- [ ] **Step 4: Run the full admin UI test file**

Run:

```bash
npx vitest run tests/admin-ui.test.tsx
```

Expected: all tests pass.

## Task 5: Visual Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run full verification**

Run:

```bash
npx vitest run tests/admin-ui.test.tsx tests/admin-styles.test.ts
npm run typecheck
npm run build
```

Expected: tests and typecheck pass, build exits 0. The existing Vite admin chunk warning may still appear.

- [ ] **Step 2: Start the dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite reports a localhost URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 3: Verify editor layout with Playwright or Browser**

Mock the admin APIs as existing tests do and open `/admin/posts`. Create a local draft, then check:

```js
({
	writing: !!document.querySelector(".admin-editor-writing"),
	details: !!document.querySelector(".admin-editor-details"),
	columns: getComputedStyle(document.querySelector(".admin-editor-workspace")).gridTemplateColumns,
	titleInWriting: !!document.querySelector(".admin-editor-writing input[type='text']"),
	detailsSticky: getComputedStyle(document.querySelector(".admin-editor-details-card")).position,
})
```

Expected on desktop:

```json
{
  "writing": true,
  "details": true,
  "detailsSticky": "sticky"
}
```

Resize to a mobile viewport around `390x844` and verify:

```js
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

Expected: `true`.

- [ ] **Step 4: Stop the dev server and clean test artifacts**

Stop any Vite process started for verification and remove generated browser artifacts such as `.playwright-cli/` if present.

- [ ] **Step 5: Final status**

Run:

```bash
git status --short --branch
```

Expected: only intended source/test changes are present.
