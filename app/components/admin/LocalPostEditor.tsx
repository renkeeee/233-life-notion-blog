import { useEffect, useMemo, useRef, useState } from "react";
import {
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	CreateLink,
	DiffSourceToggleWrapper,
	InsertImage,
	InsertTable,
	InsertThematicBreak,
	ListsToggle,
	MDXEditor,
	Separator,
	UndoRedo,
	diffSourcePlugin,
	headingsPlugin,
	imagePlugin,
	linkDialogPlugin,
	linkPlugin,
	listsPlugin,
	markdownShortcutPlugin,
	quotePlugin,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
	type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { apiPost, apiPut } from "../../lib/api-client";

export type LocalPostDraft = {
	id: string;
	postId: string | null;
	title: string;
	slug: string | null;
	excerpt: string;
	markdown: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	status: "draft" | "published" | "archived";
	commentsEnabled: boolean | null;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

type LocalPostDraftResponse = {
	draft: LocalPostDraft;
};

type UploadResponse = {
	asset?: {
		url?: string;
	};
	markdown?: string;
	url?: string;
};

type LocalPostEditorProps = {
	csrfToken: string;
	draft: LocalPostDraft;
	immersive?: boolean;
	onBack: () => void;
	onDraftChange: (draft: LocalPostDraft) => void;
	onImmersiveChange?: (immersive: boolean) => void;
	onPublished: () => Promise<void> | void;
};

function inputDateTimeValue(value: string | null): string {
	if (!value) {
		return "";
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value.slice(0, 16);
	}

	const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
	return localDate.toISOString().slice(0, 16);
}

function apiDateTimeValue(value: string): string | null {
	if (!value.trim()) {
		return null;
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function tagsInputValue(tags: string[]): string {
	return tags.join(", ");
}

function tagsApiValue(value: string): string[] {
	return value
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
}

function uploadErrorMessage(body: unknown, fallback: string): string {
	if (
		typeof body === "object" &&
		body !== null &&
		"error" in body &&
		typeof body.error === "object" &&
		body.error !== null &&
		"message" in body.error &&
		typeof body.error.message === "string"
	) {
		return body.error.message;
	}

	return fallback;
}

function EnterImmersiveIcon() {
	return (
		<svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
			<path d="M4 8V4h4" />
			<path d="M12 4h4v4" />
			<path d="M16 12v4h-4" />
			<path d="M8 16H4v-4" />
		</svg>
	);
}

function ExitImmersiveIcon() {
	return (
		<svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
			<path d="M8 4v4H4" />
			<path d="M12 4v4h4" />
			<path d="M16 12h-4v4" />
			<path d="M4 12h4v4" />
		</svg>
	);
}

export function LocalPostEditor({
	csrfToken,
	draft,
	immersive,
	onBack,
	onDraftChange,
	onImmersiveChange,
	onPublished,
}: LocalPostEditorProps) {
	const editorRef = useRef<MDXEditorMethods>(null);
	const [title, setTitle] = useState(draft.title);
	const [slug, setSlug] = useState(draft.slug ?? "");
	const [publishedAt, setPublishedAt] = useState(
		inputDateTimeValue(draft.publishedAt),
	);
	const [excerpt, setExcerpt] = useState(draft.excerpt ?? "");
	const [category, setCategory] = useState(draft.category ?? "");
	const [tags, setTags] = useState(tagsInputValue(draft.tags));
	const [commentsEnabled, setCommentsEnabled] = useState(
		draft.commentsEnabled ?? true,
	);
	const [commentsEnabledTouched, setCommentsEnabledTouched] = useState(false);
	const [markdown, setMarkdown] = useState(draft.markdown ?? "");
	const [dirty, setDirty] = useState(false);
	const [localImmersive, setLocalImmersive] = useState(false);
	const [saving, setSaving] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [status, setStatus] = useState("Draft ready.");
	const [error, setError] = useState<string | null>(null);
	const isImmersive = immersive ?? localImmersive;

	function updateImmersive(nextImmersive: boolean) {
		if (onImmersiveChange) {
			onImmersiveChange(nextImmersive);
			return;
		}

		setLocalImmersive(nextImmersive);
	}

	useEffect(() => {
		if (!isImmersive) {
			return;
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			if (document.querySelector('[role="dialog"]')) {
				return;
			}

			updateImmersive(false);
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isImmersive, onImmersiveChange]);

	const editorPlugins = useMemo(
		() => [
			toolbarPlugin({
				toolbarClassName: "admin-mdx-toolbar",
				toolbarContents: () => (
					<DiffSourceToggleWrapper options={["rich-text", "source", "diff"]}>
						<UndoRedo />
						<Separator />
						<BoldItalicUnderlineToggles />
						<Separator />
						<ListsToggle />
						<Separator />
						<BlockTypeSelect />
						<Separator />
						<CreateLink />
						<InsertImage />
						<InsertTable />
						<InsertThematicBreak />
					</DiffSourceToggleWrapper>
				),
			}),
			diffSourcePlugin({
				diffMarkdown: draft.markdown ?? "",
				viewMode: "rich-text",
			}),
			headingsPlugin(),
			imagePlugin({
				imageUploadHandler: uploadEditorImage,
			}),
			tablePlugin(),
			listsPlugin(),
			linkPlugin(),
			linkDialogPlugin(),
			quotePlugin(),
			thematicBreakPlugin(),
			markdownShortcutPlugin(),
		],
		[csrfToken, draft.markdown],
	);

	function markDirty() {
		setDirty(true);
		setStatus("Unsaved changes.");
	}

	function draftPayload() {
		return {
			title,
			slug: slug.trim() ? slug.trim() : null,
			excerpt,
			markdown,
			coverUrl: draft.coverUrl,
			category: category.trim() ? category.trim() : null,
			tags: tagsApiValue(tags),
			commentsEnabled:
				commentsEnabledTouched || draft.commentsEnabled !== null
					? commentsEnabled
					: null,
			publishedAt: apiDateTimeValue(publishedAt),
		};
	}

	async function saveDraft(): Promise<boolean> {
		setSaving(true);
		setError(null);
		setStatus("Saving draft...");

		try {
			const response = await apiPut<LocalPostDraftResponse>(
				`/api/admin/local-posts/${encodeURIComponent(draft.id)}`,
				draftPayload(),
				csrfToken,
			);
			onDraftChange(response.draft);
			setDirty(false);
			setStatus("Draft saved.");
			return true;
		} catch (saveError) {
			setError(
				saveError instanceof Error ? saveError.message : "Draft could not be saved.",
			);
			setStatus("Draft was not saved.");
			return false;
		} finally {
			setSaving(false);
		}
	}

	async function publishDraft() {
		setPublishing(true);
		setError(null);
		setStatus("Publishing...");

		const saved = await saveDraft();
		if (!saved) {
			setPublishing(false);
			return;
		}

		try {
			const response = await apiPost<LocalPostDraftResponse>(
				`/api/admin/local-posts/${encodeURIComponent(draft.id)}/publish`,
				{},
				csrfToken,
			);
			onDraftChange(response.draft);
			setDirty(false);
			setStatus("Published.");
			await onPublished();
		} catch (publishError) {
			setError(
				publishError instanceof Error
					? publishError.message
					: "Draft could not be published.",
			);
			setStatus("Draft was not published.");
		} finally {
			setPublishing(false);
		}
	}

	async function uploadEditorImage(file: File): Promise<string> {
		setUploading(true);
		setError(null);
		setStatus("Uploading image...");

		try {
			const response = await fetch("/api/admin/uploads", {
				method: "POST",
				credentials: "same-origin",
				headers: {
					"content-type": file.type || "application/octet-stream",
					"x-csrf-token": csrfToken,
				},
				body: file,
			});
			const body = (await response.json()) as UploadResponse;
			if (!response.ok) {
				throw new Error(uploadErrorMessage(body, "Image could not be uploaded."));
			}

			const url = body.asset?.url ?? body.url;
			if (!url) {
				throw new Error("Image upload response did not include a URL.");
			}

			setStatus("Image uploaded.");
			return url;
		} catch (uploadError) {
			setError(
				uploadError instanceof Error
					? uploadError.message
					: "Image could not be uploaded.",
			);
			setStatus("Image was not uploaded.");
			throw uploadError;
		} finally {
			setUploading(false);
		}
	}

	const busy = saving || publishing || uploading;
	const saveLabel = saving ? "Saving..." : "Save draft";
	const publishLabel = publishing ? "Publishing..." : "Publish";
	const draftStateLabel = dirty ? "Unsaved changes" : `Status: ${draft.status}`;

	return (
		<div
			className={`admin-stack admin-local-post-editor${
				isImmersive ? " immersive" : ""
			}`}
		>
			{isImmersive ? null : (
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
			)}

			<div
				className={`admin-editor-workspace${isImmersive ? " immersive" : ""}`}
			>
				<section
					className={`admin-module admin-editor-writing${
						isImmersive ? " immersive" : ""
					}`}
					aria-labelledby="admin-editor-writing-heading"
				>
					<div className="admin-editor-section-heading">
						<div>
							<p className="admin-eyebrow">
								{isImmersive ? "Immersive mode" : "Writing canvas"}
							</p>
							<h3 id="admin-editor-writing-heading">
								{isImmersive ? "Immersive editor" : "Writing canvas"}
							</h3>
						</div>
						<button
							type="button"
							className="admin-editor-mode-button"
							aria-label={
								isImmersive ? "Exit immersive mode" : "Enter immersive mode"
							}
							title={isImmersive ? "Exit immersive mode" : "Enter immersive mode"}
							disabled={!isImmersive && busy}
							onClick={() => updateImmersive(!isImmersive)}
						>
							{isImmersive ? <ExitImmersiveIcon /> : <EnterImmersiveIcon />}
						</button>
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

				{isImmersive ? null : (
					<section
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
						</div>
					</section>
				)}
			</div>
		</div>
	);
}
