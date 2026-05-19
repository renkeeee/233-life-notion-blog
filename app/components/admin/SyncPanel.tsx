import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import DatePicker from "react-datepicker";
import { apiGet, apiPost } from "../../lib/api-client";

type SyncRun = {
	id: string;
	trigger_type?: string;
	triggerType?: string;
	status: string;
	started_at?: string;
	startedAt?: string;
	finished_at?: string | null;
	finishedAt?: string | null;
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
								<th>Started</th>
							</tr>
						</thead>
						<tbody>
							{runs.map((run) => (
								<tr key={run.id}>
									<td>{run.id}</td>
									<td>{run.triggerType ?? run.trigger_type ?? "-"}</td>
									<td>{run.status}</td>
									<td>{run.startedAt ?? run.started_at ?? "-"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</div>
	);
}
