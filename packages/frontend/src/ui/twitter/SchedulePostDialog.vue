<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal ref="modal" preferType="dialog" zPriority="high" @click="cancel" @closed="emit('closed')" @esc="cancel">
	<section :class="$style.root" aria-labelledby="twitter-schedule-post-title">
		<header :class="$style.header">
			<h1 id="twitter-schedule-post-title" :class="$style.title">{{ i18n.ts.schedulePost }}</h1>
			<button
				class="_button"
				:class="$style.close"
				type="button"
				:aria-label="i18n.ts.close"
				@click="cancel"
			>
				<i class="ti ti-x" aria-hidden="true"></i>
			</button>
		</header>

		<div :class="$style.content">
			<section :class="$style.dateSection">
				<h2 :class="$style.sectionTitle">{{ i18n.ts._twitterUi.scheduleDate }}</h2>
				<div :class="$style.monthHeader">
					<button
						class="_button"
						:class="$style.monthButton"
						type="button"
						:aria-label="i18n.ts._twitterUi.previousMonth"
						@click="changeMonth(-1)"
					>
						<i class="ti ti-chevron-left" aria-hidden="true"></i>
					</button>
					<div :class="$style.monthTitle">{{ monthTitle }}</div>
					<button
						class="_button"
						:class="$style.monthButton"
						type="button"
						:aria-label="i18n.ts._twitterUi.nextMonth"
						@click="changeMonth(1)"
					>
						<i class="ti ti-chevron-right" aria-hidden="true"></i>
					</button>
				</div>

				<div :class="$style.calendar" role="grid">
					<div :class="$style.weekdays" role="row">
						<span
							v-for="(weekday, index) in weekdays"
							:key="index"
							:class="$style.weekday"
							role="columnheader"
							:aria-label="weekdayLabels[index]"
						>{{ weekday }}</span>
					</div>
					<div :class="$style.days" role="row">
						<button
							v-for="day in days"
							:key="day.key"
							class="_button"
							:class="[$style.day, {
								[$style.empty]: day.date == null,
								[$style.selected]: day.selected,
								[$style.today]: day.isToday,
							}]"
							type="button"
							:disabled="day.date == null"
							:aria-selected="day.selected"
							:aria-label="day.ariaLabel"
							role="gridcell"
							@click="selectDay(day.date!)"
						>
							{{ day.label }}
						</button>
					</div>
				</div>
			</section>

			<section :class="$style.timeSection">
				<h2 :class="$style.sectionTitle">{{ i18n.ts._twitterUi.scheduleTime }}</h2>
				<div :class="$style.timeFields">
					<input
						v-model="hourText"
						:class="$style.timeInput"
						type="text"
						inputmode="numeric"
						maxlength="2"
						aria-label="HH"
						@input="normalizeHour"
					>
					<span aria-hidden="true">:</span>
					<input
						v-model="minuteText"
						:class="$style.timeInput"
						type="text"
						inputmode="numeric"
						maxlength="2"
						aria-label="MM"
						@input="normalizeMinute"
					>
				</div>
				<p :class="$style.timezone">{{ timeZone }}</p>
				<p v-if="isPast" :class="$style.error">{{ i18n.ts._twitterUi.scheduleTimeIsInThePast }}</p>
			</section>
		</div>

		<footer :class="$style.footer">
			<button class="_button" :class="$style.cancelButton" type="button" @click="cancel">
				{{ i18n.ts.cancel }}
			</button>
			<button
				class="_button"
				:class="$style.submitButton"
				type="button"
				:disabled="isPast"
				@click="submit"
			>
				{{ i18n.ts.schedulePost }}
			</button>
		</footer>
	</section>
</MkModal>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { i18n } from '@/i18n.js';
import { timeZone, versatileLang } from '@@/js/intl-const.js';

const props = withDefaults(defineProps<{
	default?: number | null;
}>(), {
	default: null,
});

const emit = defineEmits<{
	(ev: 'done', value: { canceled: boolean; result?: number }): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');

const initialDate = computed(() => {
	if (props.default != null && props.default > Date.now()) {
		return new Date(props.default);
	}

	const date = new Date();
	date.setMinutes(Math.ceil((date.getMinutes() + 1) / 15) * 15, 0, 0);
	return date;
});

const selectedYear = ref(initialDate.value.getFullYear());
const selectedMonth = ref(initialDate.value.getMonth());
const selectedDay = ref(initialDate.value.getDate());
const viewYear = ref(initialDate.value.getFullYear());
const viewMonth = ref(initialDate.value.getMonth());
const hourText = ref(String(initialDate.value.getHours()).padStart(2, '0'));
const minuteText = ref(String(initialDate.value.getMinutes()).padStart(2, '0'));

const monthFormatter = new Intl.DateTimeFormat(versatileLang, {
	year: 'numeric',
	month: 'long',
});
const dayFormatter = new Intl.DateTimeFormat(versatileLang, {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
});
const narrowWeekdayFormatter = new Intl.DateTimeFormat(versatileLang, {
	weekday: 'narrow',
});
const longWeekdayFormatter = new Intl.DateTimeFormat(versatileLang, {
	weekday: 'long',
});

const monthTitle = computed(() => monthFormatter.format(new Date(viewYear.value, viewMonth.value, 1)));
const weekdayLabels = Array.from({ length: 7 }, (_, index) => {
	return longWeekdayFormatter.format(new Date(2023, 0, index + 1));
});
const weekdays = weekdayLabels.map((_, index) => narrowWeekdayFormatter.format(new Date(2023, 0, index + 1)));

const selectedTime = computed(() => {
	return new Date(
		selectedYear.value,
		selectedMonth.value,
		selectedDay.value,
		Number(hourText.value),
		Number(minuteText.value),
	).getTime();
});

const isPast = computed(() => selectedTime.value <= Date.now());

const days = computed(() => {
	const firstDay = new Date(viewYear.value, viewMonth.value, 1);
	const monthLength = new Date(viewYear.value, viewMonth.value + 1, 0).getDate();
	const leadingEmptyCount = firstDay.getDay();
	const today = new Date();
	const result: {
		key: string;
		date: Date | null;
		label: string;
		selected: boolean;
		isToday: boolean;
		ariaLabel: string;
	}[] = [];

	for (let index = 0; index < leadingEmptyCount; index++) {
		result.push({
			key: `empty-${index}`,
			date: null,
			label: '',
			selected: false,
			isToday: false,
			ariaLabel: '',
		});
	}

	for (let day = 1; day <= monthLength; day++) {
		const date = new Date(viewYear.value, viewMonth.value, day);
		result.push({
			key: `${viewYear.value}-${viewMonth.value}-${day}`,
			date,
			label: String(day),
			selected: date.getFullYear() === selectedYear.value
				&& date.getMonth() === selectedMonth.value
				&& date.getDate() === selectedDay.value,
			isToday: date.getFullYear() === today.getFullYear()
				&& date.getMonth() === today.getMonth()
				&& date.getDate() === today.getDate(),
			ariaLabel: dayFormatter.format(date),
		});
	}

	return result;
});

function changeMonth(delta: number) {
	const next = new Date(viewYear.value, viewMonth.value + delta, 1);
	viewYear.value = next.getFullYear();
	viewMonth.value = next.getMonth();
}

function selectDay(date: Date) {
	selectedYear.value = date.getFullYear();
	selectedMonth.value = date.getMonth();
	selectedDay.value = date.getDate();
}

function normalizeHour() {
	const hour = Number(hourText.value.replace(/\D/g, ''));
	hourText.value = Number.isNaN(hour) ? '' : String(Math.min(hour, 23)).padStart(2, '0');
}

function normalizeMinute() {
	const minute = Number(minuteText.value.replace(/\D/g, ''));
	minuteText.value = Number.isNaN(minute) ? '' : String(Math.min(minute, 59)).padStart(2, '0');
}

function cancel() {
	emit('done', { canceled: true });
	modal.value?.close();
}

function submit() {
	if (isPast.value) return;
	emit('done', {
		canceled: false,
		result: selectedTime.value,
	});
	modal.value?.close();
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 20px;
	width: min(360px, calc(100vw - 32px));
	padding: 0;
	background: var(--twitter-bg);
	color: var(--twitter-fg);
	border: solid 0.5px var(--twitter-border);
	border-radius: var(--twitter-radius-large);
	box-shadow: 0 8px 32px color-mix(in srgb, var(--twitter-fg) 28%, transparent);
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 16px 0;
}

.title {
	margin: 0;
	font-size: 18px;
	font-weight: 800;
}

.close {
	display: grid;
	place-items: center;
	width: 32px;
	height: 32px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}

.content {
	display: grid;
	gap: 20px;
	padding: 0 16px;
}

.sectionTitle {
	margin: 0 0 8px;
	color: var(--twitter-secondary-fg);
	font-size: 13px;
	font-weight: 700;
}

.monthHeader {
	display: grid;
	grid-template-columns: 32px minmax(0, 1fr) 32px;
	align-items: center;
	margin-bottom: 8px;
}

.monthTitle {
	text-align: center;
	font-size: 15px;
	font-weight: 800;
}

.monthButton {
	display: grid;
	place-items: center;
	width: 32px;
	height: 32px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	transition: background-color var(--twitter-duration-fast) ease;

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}

.weekdays,
.days {
	display: grid;
	grid-template-columns: repeat(7, minmax(0, 1fr));
	gap: 2px;
}

.weekday {
	display: grid;
	place-items: center;
	height: 28px;
	color: var(--twitter-secondary-fg);
	font-size: 12px;
	font-weight: 700;
}

.day {
	position: relative;
	display: grid;
	place-items: center;
	aspect-ratio: 1;
	max-height: 40px;
	border-radius: var(--twitter-radius-pill);
	color: var(--twitter-fg);
	font-size: 14px;
	transition:
		background-color var(--twitter-duration-fast) ease,
		color var(--twitter-duration-fast) ease;

	&:hover:not(:disabled) {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}

	&.empty {
		cursor: default;
	}

	&.today {
		border: solid 1px var(--twitter-accent);
	}

	&.selected {
		background: var(--twitter-accent);
		color: var(--MI_THEME-fgOnAccent);

		&:hover {
			background: var(--twitter-accent-hover);
		}
	}
}

.timeFields {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
}

.timeInput {
	width: 72px;
	height: 40px;
	box-sizing: border-box;
	padding: 0 12px;
	border: solid 1px var(--twitter-border);
	border-radius: var(--twitter-radius-medium);
	background: var(--twitter-bg);
	color: var(--twitter-fg);
	font: inherit;
	font-size: 16px;
	font-weight: 700;
	text-align: center;
	outline: none;
	transition: border-color var(--twitter-duration-fast) ease;

	&:focus {
		border-color: var(--twitter-accent);
	}
}

.timezone,
.error {
	margin: 8px 0 0;
	text-align: center;
	font-size: 12px;
}

.timezone {
	color: var(--twitter-secondary-fg);
}

.error {
	color: var(--twitter-danger);
}

.footer {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 0 16px 16px;
}

.cancelButton,
.submitButton {
	height: 36px;
	padding: 0 16px;
	border-radius: var(--twitter-radius-pill);
	font-size: 14px;
	font-weight: 700;
	transition:
		background-color var(--twitter-duration-fast) ease,
		opacity var(--twitter-duration-fast) ease;
}

.cancelButton {
	border: solid 1px var(--twitter-secondary-fg);
	color: var(--twitter-fg);

	&:hover {
		background: color-mix(in srgb, var(--twitter-fg) 8%, transparent);
	}
}

.submitButton {
	background: var(--twitter-accent);
	color: var(--MI_THEME-fgOnAccent);

	&:hover:not(:disabled) {
		background: var(--twitter-accent-hover);
	}

	&:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
}

@media (prefers-reduced-motion: reduce) {
	.close,
	.monthButton,
	.day,
	.timeInput,
	.cancelButton,
	.submitButton {
		transition: none;
	}
}
</style>
