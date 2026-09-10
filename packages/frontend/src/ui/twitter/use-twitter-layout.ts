/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onBeforeUnmount, onMounted, ref } from 'vue';
import { deviceKind } from '@/utility/device-kind.js';

const MOBILE_THRESHOLD = 500;
const SIDEBAR_THRESHOLD = MOBILE_THRESHOLD + 1;
const RIGHT_RAIL_THRESHOLD = 1280;

export function useTwitterLayout() {
	const isMobile = ref(deviceKind === 'smartphone' || window.innerWidth <= MOBILE_THRESHOLD);
	const showSidebar = ref(window.innerWidth >= SIDEBAR_THRESHOLD);
	const showRightRail = ref(window.innerWidth >= RIGHT_RAIL_THRESHOLD);

	let mobileMediaQueryList: MediaQueryList | null = null;
	let sidebarMediaQueryList: MediaQueryList | null = null;
	let rightRailMediaQueryList: MediaQueryList | null = null;

	function syncMobile() {
		isMobile.value = deviceKind === 'smartphone' || window.innerWidth <= MOBILE_THRESHOLD;
	}

	function syncSidebar() {
		showSidebar.value = window.innerWidth >= SIDEBAR_THRESHOLD;
	}

	function syncRightRail() {
		showRightRail.value = window.innerWidth >= RIGHT_RAIL_THRESHOLD;
	}

	onMounted(() => {
		mobileMediaQueryList = window.matchMedia(`(max-width: ${MOBILE_THRESHOLD}px)`);
		sidebarMediaQueryList = window.matchMedia(`(min-width: ${SIDEBAR_THRESHOLD}px)`);
		rightRailMediaQueryList = window.matchMedia(`(min-width: ${RIGHT_RAIL_THRESHOLD}px)`);

		mobileMediaQueryList.addEventListener('change', syncMobile);
		sidebarMediaQueryList.addEventListener('change', syncSidebar);
		rightRailMediaQueryList.addEventListener('change', syncRightRail);
	});

	onBeforeUnmount(() => {
		mobileMediaQueryList?.removeEventListener('change', syncMobile);
		sidebarMediaQueryList?.removeEventListener('change', syncSidebar);
		rightRailMediaQueryList?.removeEventListener('change', syncRightRail);
	});

	return {
		isMobile,
		showSidebar,
		showRightRail,
	};
}
