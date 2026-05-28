# Admin Post Editor Redesign Design

## Goal

Redesign the local article editor in the admin Posts section so writing is the primary task and publishing metadata is organized in a dedicated side rail.

The redesign keeps the existing local draft model, MDXEditor integration, image upload, save draft, publish, and return-to-list behavior. It changes layout, hierarchy, and interaction placement only.

## Confirmed Direction

Use the selected "writing-first" two-column structure:

- left column: title, Markdown editor, image upload;
- right column: status, slug, summary, published date, category, tags, comments setting, save draft, publish;
- mobile: collapse to one column with writing first and article details below;
- no real-time preview in this iteration;
- no editor library replacement;
- no API or data model changes.

## Current Problems

The current editor stacks all fields in a single flow:

- writing controls and publishing metadata have equal visual weight;
- the Markdown editor is not dominant enough for a writing workflow;
- save, publish, and back actions sit at the bottom, far from context while editing long posts;
- status feedback is a plain note, so unsaved, saving, uploading, and published states are not easy to scan.

## Layout

### Desktop

The editor becomes a two-column workspace inside the existing admin shell.

```text
Editor top bar
  Back to posts | current draft state | Save draft | Publish

Main grid
  Writing canvas
    Title
    Markdown toolbar with Upload image
    MDXEditor body

  Article details rail
    Status
    Slug
    Summary
    Published at
    Category
    Tags
    Comments enabled
    Save draft
    Publish
```

The writing canvas should take most horizontal space. The article details rail should be narrower, readable, and sticky when viewport height allows it.

### Mobile

On narrow screens, the layout collapses to:

```text
Top bar
Title
Markdown editor
Article details
Actions
```

The side rail becomes a normal section below the editor. Buttons remain full-width or easy to tap.

## Components

Keep `LocalPostEditor` as the main component for this iteration, but split the JSX into clearer internal sections:

- editor heading / top action bar;
- writing canvas;
- article details rail;
- editor status;
- action buttons.

This can be done with small helper render blocks or local components inside the same file if it improves readability. Avoid moving API behavior out of the component unless needed for clarity.

## Interaction

The main actions appear in the top action bar and in the right rail. They should call the same existing handlers:

- `Back` calls `onBack`;
- `Save draft` calls `saveDraft`;
- `Publish` calls `publishDraft`;
- image upload still appends Markdown through the editor ref.

Busy states should remain functionally identical:

- inputs disabled while saving, publishing, or uploading;
- MDXEditor read-only while busy;
- upload control disabled while busy;
- buttons disabled while busy.

The visual state should be stronger than the current single note:

- show a compact status chip or status row for draft state;
- keep inline error text near the actions/status area;
- keep the existing status text content so tests and behavior remain stable where practical.

## Styling

Use the existing `app/app.css` admin design language:

- restrained admin surfaces;
- 8px radii;
- existing admin colors and badges;
- no new dependency;
- no decorative marketing treatment.

The redesigned editor should feel like a focused authoring tool, not a landing page. The left canvas should be quiet and spacious; the right rail should be dense but readable.

## Accessibility

Preserve label associations for all inputs:

- Title;
- Slug;
- Published at;
- Summary;
- Category;
- Tags;
- Enable comments;
- Upload image;
- Markdown.

Do not hide or rename existing accessible controls in a way that breaks keyboard or screen-reader use. Focus styles must remain visible through existing admin button/input rules.

## Testing

Update admin UI tests to cover the new layout without overfitting to CSS implementation:

- creating a draft still opens the editor;
- title and Markdown remain in the writing canvas;
- slug and summary render in the article details rail;
- save draft sends the same payload;
- busy state still disables controls;
- image upload still inserts Markdown;
- publishing still saves first, publishes, returns to the list, and refreshes posts;
- mobile/layout CSS can be covered through existing style tests if useful.

## Non-Goals

This redesign does not include:

- live rendered preview;
- split editor/preview mode;
- scheduled publishing;
- revision history;
- autosave;
- drag-and-drop media management;
- changing local post API endpoints;
- changing public post rendering.
