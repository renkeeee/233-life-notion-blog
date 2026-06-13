import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import DatePicker from "react-datepicker";
import { apiGet, apiPost, apiPut } from "../../lib/api-client";

type SyncRun = {
	id: string;
	trigger_type?: string;
	triggerType?: string;
	status: string;
	started_at?: string;
	startedAt?: string;
	finished_at?: string | null;
	finishedAt?: string | null;
	created_count?: number;
	createdCount?: number;
	updated_count?: number;
	updatedCount?: number;
	metadata_only_count?: number;
	metadataOnlyCount?: number;
	skipped_count?: number;
	skippedCount?: number;
	unpublished_count?: number;
	unpublishedCount?: number;
	archived_count?: number;
	archivedCount?: number;
	failed_count?: number;
	failedCount?: number;
	error_message?: string | null;
	errorMessage?: string | null;
};

type SyncRunSummary = {
	id: string;
	triggerType: string;
	startedAt: string;
	finishedAt: string | null;
	status: string;
	rangeStart: string | null;
	rangeEnd: string | null;
	force: boolean;
	createdCount: number;
	updatedCount: number;
	metadataOnlyCount: number;
	skippedCount: number;
	unpublishedCount: number;
	archivedCount: number;
	failedCount: number;
	errorCode: string | null;
	errorMessage: string | null;
};

type SyncRunItem = {
	id: string;
	notionPageId: string;
	postId: string | null;
	action: string;
	status: "success" | "skipped" | "failed";
	errorCode: string | null;
	errorMessage: string | null;
	startedAt: string;
	finishedAt: string | null;
};

type SyncRunDetail = {
	run: SyncRunSummary;
	items: SyncRunItem[];
};

type SyncSettingsResponse = {
	scheduledSyncEnabled: boolean;
};

type DateTimeValue = Date | null;

function toIsoDateTime(value: DateTimeValue): string | null {
	if (!value) {
		return null;
	}

	if (Number.isNaN(value.getTime())) {
		throw new Error("Invalid date/time range.");
	}

	return value.toISOString();
}

function runTrigger(run: SyncRun): string {
	return run.triggerType ?? run.trigger_type ?? "-";
}

function runStartedAt(run: SyncRun): string {
	return run.startedAt ?? run.started_at ?? "-";
}

function runFinishedAt(run: SyncRun): string | null {
	return run.finishedAt ?? run.finished_at ?? null;
}

function runCount(run: SyncRun, camelKey: keyof SyncRun, snakeKey: keyof SyncRun): number {
	const value = run[camelKey] ?? run[snakeKey] ?? 0;
	return typeof value === "number" ? value : 0;
}

function runItemSummary(run: SyncRun): string {
	const changed =
		runCount(run, "createdCount", "created_count") +
		runCount(run, "updatedCount", "updated_count") +
		runCount(run, "metadataOnlyCount", "metadata_only_count");
	const skipped = runCount(run, "skippedCount", "skipped_count");
	const failed = runCount(run, "failedCount", "failed_count");

	return `${changed} changed / ${skipped} skipped / ${failed} failed`;
}

function AdminDateTimePicker({
	label,
	value,
	onChange,
	disabled,
}: {
	label: string;
	value: DateTimeValue;
	onChange: (value: DateTimeValue) => void;
	disabled?: boolean;
}) {
	const inputId = useId();

	return (
		<div className="admin-datetime-field">
			<label htmlFor={inputId}>{label}</label>
			<DatePicker
				ariaLabel={label}
				autoComplete="off"
				calendarClassName="admin-date-time-calendar"
				className="admin-date-time-input"
				dateFormat="yyyy-MM-dd HH:mm"
				disabled={disabled}
				id={inputId}
				isClearable
				onChange={onChange}
				placeholderText="yyyy-MM-dd HH:mm"
				popperClassName="admin-date-time-popper"
				selected={value}
				shouldCloseOnSelect={false}
				showTimeSelect
				timeCaption="Time"
				timeFormat="HH:mm"
				timeIntervals={5}
				wrapperClassName="admin-date-time-picker"
			/>
		</div>
	);
}

export function SyncPanel({
	csrfToken,
	disabled,
}: {
	csrfToken: string;
	disabled?: boolean;
}) {
	const [rangeStart, setRangeStart] = useState<DateTimeValue>(null);
	const [rangeEnd, setRangeEnd] = useState<DateTimeValue>(null);
	const [force, setForce] = useState(false);
	const [status, setStatus] = useState("Ready to sync.");
	const [runs, setRuns] = useState<SyncRun[]>([]);
	const [historyStatus, setHistoryStatus] = useState("Loading sync history...");
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [runDetail, setRunDetail] = useState<SyncRunDetail | null>(null);
	const [detailStatus, setDetailStatus] = useState(
		"Select a sync run to view details.",
	);
	const [detailLoading, setDetailLoading] = useState(false);
	const [scheduledSyncEnabled, setScheduledSyncEnabled] = useState(true);
	const [settingsLoaded, setSettingsLoaded] = useState(false);
	const [settingsPending, setSettingsPending] = useState(false);
	const [settingsStatus, setSettingsStatus] = useState(
		"Loading scheduled sync settings...",
	);

	useEffect(() => {
		if (disabled) {
			setHistoryStatus("Sync history is locked until the initial password is changed.");
			return;
		}

		let cancelled = false;
		apiGet<{ items: SyncRun[] }>("/api/admin/sync-runs")
			.then((response) => {
				if (!cancelled) {
					const items = response.items ?? [];
					setRuns(items);
					setHistoryStatus(items.length ? "Recent sync runs" : "No sync runs yet.");
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setHistoryStatus(
						error instanceof Error
							? error.message
							: "Sync history could not be loaded.",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [disabled]);

	useEffect(() => {
		if (disabled) {
			setSettingsLoaded(false);
			setSettingsStatus(
				"Scheduled sync settings are locked until the initial password is changed.",
			);
			return;
		}

		let cancelled = false;
		setSettingsStatus("Loading scheduled sync settings...");
		apiGet<SyncSettingsResponse>("/api/admin/sync/settings")
			.then((response) => {
				if (!cancelled) {
					setScheduledSyncEnabled(response.scheduledSyncEnabled !== false);
					setSettingsLoaded(true);
					setSettingsStatus("Scheduled sync settings loaded.");
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setSettingsLoaded(false);
					setSettingsStatus(
						error instanceof Error
							? error.message
							: "Scheduled sync settings could not be loaded.",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [disabled]);

	async function startSync(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setStatus("Starting sync...");
		try {
			const response = await apiPost<{ runId: string }>(
				"/api/admin/sync",
				{
					rangeStart: toIsoDateTime(rangeStart),
					rangeEnd: toIsoDateTime(rangeEnd),
					force,
				},
				csrfToken,
			);
			setStatus(`Sync queued: ${response.runId}`);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Sync could not start.");
		}
	}

	async function saveSyncSettings(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!settingsLoaded || settingsPending) {
			return;
		}

		setSettingsPending(true);
		setSettingsStatus("Saving scheduled sync settings...");
		try {
			const response = await apiPut<SyncSettingsResponse>(
				"/api/admin/sync/settings",
				{ scheduledSyncEnabled },
				csrfToken,
			);
			setScheduledSyncEnabled(response.scheduledSyncEnabled !== false);
			setSettingsStatus("Scheduled sync settings saved.");
		} catch (error) {
			setSettingsStatus(
				error instanceof Error
					? error.message
					: "Scheduled sync settings could not be saved.",
			);
		} finally {
			setSettingsPending(false);
		}
	}

	async function loadRunDetails(runId: string) {
		setSelectedRunId(runId);
		setRunDetail(null);
		setDetailLoading(true);
		setDetailStatus("Loading sync run details...");
		try {
			const response = await apiGet<SyncRunDetail>(
				`/api/admin/sync-runs/${encodeURIComponent(runId)}`,
			);
			setRunDetail(response);
			setDetailStatus(
				response.items.length
					? `${response.items.length} sync item${
							response.items.length === 1 ? "" : "s"
						}.`
					: "No item-level log entries for this run.",
			);
		} catch (error) {
			setDetailStatus(
				error instanceof Error
					? error.message
					: "Sync run details could not be loaded.",
			);
		} finally {
			setDetailLoading(false);
		}
	}

	function closeRunDetails() {
		setSelectedRunId(null);
		setRunDetail(null);
		setDetailLoading(false);
		setDetailStatus("Select a sync run to view details.");
	}

	return (
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2>Sync management</h2>
				<span className="admin-badge">Manual refresh</span>
			</div>
			{disabled ? (
				<p className="admin-warning">
					Change the initial password before running sync jobs.
				</p>
			) : null}
			<form className="admin-module admin-form compact" onSubmit={saveSyncSettings}>
				<div className="admin-section-heading compact">
					<h3>Scheduled sync</h3>
					<span className="admin-badge">
						{scheduledSyncEnabled ? "Enabled" : "Paused"}
					</span>
				</div>
				<label className="admin-switch-row">
					<input
						type="checkbox"
						aria-label="Enable scheduled sync"
						checked={scheduledSyncEnabled}
						disabled={disabled || !settingsLoaded || settingsPending}
						onChange={(event) =>
							setScheduledSyncEnabled(event.currentTarget.checked)
						}
					/>
					<span className="admin-switch-track" aria-hidden="true" />
					<span className="admin-switch-copy">
						<span>Enable scheduled sync</span>
						<small>Controls the Cloudflare cron sync. Manual sync still works.</small>
					</span>
				</label>
				<button
					type="submit"
					disabled={disabled || !settingsLoaded || settingsPending}
				>
					{settingsPending ? "Saving..." : "Save sync settings"}
				</button>
				<p className="admin-note">{settingsStatus}</p>
			</form>
			<form className="admin-form inline" onSubmit={startSync}>
				<AdminDateTimePicker
					label="Range start"
					value={rangeStart}
					onChange={setRangeStart}
					disabled={disabled}
				/>
				<AdminDateTimePicker
					label="Range end"
					value={rangeEnd}
					onChange={setRangeEnd}
					disabled={disabled}
				/>
				<label className="admin-checkbox">
					<input
						type="checkbox"
						checked={force}
						onChange={(event) => setForce(event.currentTarget.checked)}
						disabled={disabled}
					/>
					Force refresh
				</label>
				<button type="submit" disabled={disabled}>
					Start sync
				</button>
			</form>
			<p className="admin-note">{status}</p>
			<h3>History</h3>
			<p className="admin-note">{historyStatus}</p>
			{runs.length > 0 ? (
				<div className="admin-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Run</th>
								<th>Trigger</th>
								<th>Status</th>
								<th>Items</th>
								<th>Started</th>
							</tr>
						</thead>
						<tbody>
							{runs.map((run) => (
								<tr
									key={run.id}
									className={selectedRunId === run.id ? "selected" : undefined}
								>
									<td>
										<button
											type="button"
											className="admin-table-link-button admin-sync-run-button"
											aria-label={`View sync run ${run.id} details`}
											aria-pressed={selectedRunId === run.id}
											onClick={() => void loadRunDetails(run.id)}
										>
											<span className="admin-sync-run-id" aria-hidden="true">
												{run.id}
											</span>
										</button>
									</td>
									<td>{runTrigger(run)}</td>
									<td>{run.status}</td>
									<td>{runItemSummary(run)}</td>
									<td>{runStartedAt(run)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
			{selectedRunId ? (
				<div className="admin-modal-backdrop">
					<section
						className="admin-modal admin-sync-run-modal"
						aria-label={`Sync run ${selectedRunId} details`}
						aria-modal="true"
						role="dialog"
					>
						<div className="admin-section-heading">
							<div>
								<p className="admin-eyebrow">Sync log</p>
								<h3>Run {selectedRunId}</h3>
							</div>
							<div className="admin-modal-actions">
								<span className="admin-badge">
									{runDetail?.run.status ??
										(detailLoading ? "Loading" : "Details")}
								</span>
								<button
									type="button"
									className="admin-modal-secondary"
									aria-label="Close sync run details"
									onClick={closeRunDetails}
								>
									Close
								</button>
							</div>
						</div>
						<p className="admin-note">{detailStatus}</p>
						{runDetail ? (
							<>
								<div className="admin-sync-run-summary">
									<span>
										<strong>Trigger</strong>
										{runDetail.run.triggerType}
									</span>
									<span>
										<strong>Started</strong>
										{runDetail.run.startedAt}
									</span>
									<span>
										<strong>Finished</strong>
										{runDetail.run.finishedAt ?? "-"}
									</span>
									<span>
										<strong>Window</strong>
										{runDetail.run.rangeStart || runDetail.run.rangeEnd
											? `${runDetail.run.rangeStart ?? "-"} to ${
													runDetail.run.rangeEnd ?? "-"
												}`
											: "-"}
									</span>
									<span>
										<strong>Counts</strong>
										{`${runDetail.run.createdCount} created / ${
											runDetail.run.updatedCount
										} updated / ${runDetail.run.skippedCount} skipped / ${
											runDetail.run.failedCount
										} failed`}
									</span>
								</div>
								{runDetail.run.errorMessage ? (
									<p className="admin-sync-callout">
										<strong>{runDetail.run.errorCode ?? "Sync error"}</strong>
										<span>{runDetail.run.errorMessage}</span>
									</p>
								) : null}
								{runDetail.items.length > 0 ? (
									<div className="admin-table-wrap">
										<table className="admin-table">
											<thead>
												<tr>
													<th>Notion page</th>
													<th>Post</th>
													<th>Action</th>
													<th>Status</th>
													<th>Error</th>
												</tr>
											</thead>
											<tbody>
												{runDetail.items.map((item) => (
													<tr
														key={item.id}
														className={
															item.status === "failed"
																? "admin-sync-item-failed"
																: undefined
														}
													>
														<td>{item.notionPageId}</td>
														<td>{item.postId ?? "-"}</td>
														<td>{item.action}</td>
														<td>{item.status}</td>
														<td>{item.errorMessage ?? item.errorCode ?? "-"}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								) : null}
							</>
						) : null}
					</section>
				</div>
			) : null}
		</div>
	);
}
