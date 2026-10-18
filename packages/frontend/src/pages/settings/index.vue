<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：账户设置页路由宿主。
作用：呈现设置菜单和子页，保留有效设置路由的展示上下文。
数据链：全局路由只在归属 settings 时更新本页；离开后的缓存不创建无效嵌套路由，不保存业务实体。
-->

<template>
<TwitterSettingsShell
	v-if="isTwitterUi && currentPage?.route.name != null"
	:title="twitterShellTitle"
>
	<NestedRouterView/>
</TwitterSettingsShell>
<PageWithHeader v-else :tabs="headerTabs" :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 900px; --MI_SPACER-min: 20px; --MI_SPACER-max: 32px;">
		<div ref="el" class="vvcocwet" :class="{ wide: !narrow }">
			<div class="body">
				<div v-if="!narrow || currentPage?.route.name == null" class="nav">
					<div class="_gaps_s">
						<MkInfo v-if="emailNotConfigured" warn class="info">{{ i18n.ts.emailNotConfiguredWarning }} <MkA to="/settings/email" class="_link">{{ i18n.ts.configure }}</MkA></MkInfo>
						<MkInfo v-if="storagePersistenceSupported && !storagePersisted && store.r.showStoragePersistenceSuggestion.value" class="info">
							<div>{{ i18n.ts._settings.settingsPersistence_description1 }}</div>
							<div>{{ i18n.ts._settings.settingsPersistence_description2 }}</div>
							<div><button class="_textButton" @click="enableStoragePersistence">{{ i18n.ts.enable }}</button> | <button class="_textButton" @click="skipStoragePersistence">{{ i18n.ts.skip }}</button></div>
						</MkInfo>
						<MkInfo v-if="!store.r.enablePreferencesAutoCloudBackup.value && store.r.showPreferencesAutoCloudBackupSuggestion.value" class="info">
							<div>{{ i18n.ts._preferencesBackup.autoPreferencesBackupIsNotEnabledForThisDevice }}</div>
							<div><button class="_textButton" @click="enableAutoBackup">{{ i18n.ts.enable }}</button> | <button class="_textButton" @click="skipAutoBackup">{{ i18n.ts.skip }}</button></div>
						</MkInfo>
						<MkSuperMenu :def="menuDef" :grid="narrow" :searchIndex="searchIndex"></MkSuperMenu>
					</div>
				</div>
				<div v-if="currentPage?.route.name != null" class="main">
					<div style="container-type: inline-size;">
						<NestedRouterView/>
					</div>
				</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script setup lang="ts">
import { computed, inject, onActivated, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { PathResolvedResult } from '@/lib/nirax.js';
import type { PageMetadata } from '@/page.js';
import type { SuperMenuDef } from '@/components/MkSuperMenu.vue';
import { i18n } from '@/i18n.js';
import MkInfo from '@/components/MkInfo.vue';
import MkSuperMenu from '@/components/MkSuperMenu.vue';
import { $i } from '@/i.js';
import { clearCache } from '@/utility/clear-cache.js';
import { instance } from '@/instance.js';
import { definePage, provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import * as os from '@/os.js';
import { useRouter } from '@/router.js';
import { enableAutoBackup, getPreferencesProfileMenu } from '@/preferences/utility.js';
import { store } from '@/store.js';
import { signout } from '@/signout.js';
import { genSearchIndexes } from '@/utility/inapp-search.js';
import { enableStoragePersistence, getStoragePersistenceSharedRefSync, storagePersistenceSupported, skipStoragePersistence } from '@/utility/storage.js';
import { DI } from '@/di.js';
import { TwitterSettingsShell } from '@/ui/twitter/index.js';

/** 设置搜索索引后台填充，不阻塞设置树的同步挂载。 */
const searchIndex: ShallowRef<ReturnType<typeof genSearchIndexes>> = shallowRef([]);
void import('search-index:settings').then(
	/** 转换构建期搜索资料为既有菜单索引。 */
	({ searchIndexes }: typeof import('search-index:settings')): void => {
		searchIndex.value = genSearchIndexes(searchIndexes);
	},
);

/** 只读消费既有存储状态，探测实现留在原 utility。 */
const storagePersisted: Readonly<Ref<boolean>> = getStoragePersistenceSharedRefSync();

const indexInfo = {
	title: i18n.ts.settings,
	icon: 'ti ti-settings',
	hideHeader: true,
};
const INFO = ref<PageMetadata>(indexInfo);
const el = useTemplateRef('el');
const childInfo = ref<null | PageMetadata>(null);

const router = useRouter();

/** 当前 UI 样式（由 Twitter Shell 注入；非 Twitter 场景回退 'default'）。 */
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');

/** Twitter 设置子页壳标题：子页 definePage 元数据，缺失时回退“设置”。 */
const twitterShellTitle = computed<string>(() => childInfo.value?.title ?? i18n.ts.settings);

const narrow = ref(false);
const NARROW_THRESHOLD = 600;

/** 设置 UI 副作用的路由准入，不参与业务权限或实体决策。 */
const isSettingsRoute: ComputedRef<boolean> = computed(
	/** 从全局路由派生当前是否属于设置树。 */
	(): boolean => router.currentRef.value.route.name === 'settings',
);

/** 最近的有效设置子路由展示引用；非 settings 导航不将其清空。 */
const currentPage: ShallowRef<PathResolvedResult | undefined> = shallowRef(
	isSettingsRoute.value ? router.currentRef.value.child : undefined,
);
watch(router.currentRef,
	/** 只接受设置树自身的上下文，避免停用缓存被无关路由重建。 */
	(current: PathResolvedResult): void => {
		if (current.route.name === 'settings') currentPage.value = current.child;
	},
	{ flush: 'sync' },
);

/** 仅测量当前设置布局，停用缓存页不解释零尺寸。 */
const ro: ResizeObserver = new ResizeObserver(
	/** 将有效节点宽度投影为菜单展示状态。 */
	(entries: ResizeObserverEntry[]): void => {
		if (!isSettingsRoute.value || entries.length === 0) return;
		narrow.value = entries[0].borderBoxSize[0].inlineSize < NARROW_THRESHOLD;
	},
);

function skipAutoBackup() {
	store.set('showPreferencesAutoCloudBackupSuggestion', false);
}

const menuDef = computed<SuperMenuDef[]>(() => [{
	items: [{
		icon: 'ti ti-user',
		text: i18n.ts.profile,
		to: '/settings/profile',
		active: currentPage.value?.route.name === 'profile',
	}, {
		icon: 'ti ti-lock-open',
		text: i18n.ts.privacy,
		to: '/settings/privacy',
		active: currentPage.value?.route.name === 'privacy',
	}, {
		icon: 'ti ti-bell',
		text: i18n.ts.notifications,
		to: '/settings/notifications',
		active: currentPage.value?.route.name === 'notifications',
	}, {
		icon: 'ti ti-mail',
		text: i18n.ts.email,
		to: '/settings/email',
		active: currentPage.value?.route.name === 'email',
	}, {
		icon: 'ti ti-lock',
		text: i18n.ts.security,
		to: '/settings/security',
		active: currentPage.value?.route.name === 'security',
	}],
}, {
	items: [{
		icon: 'ti ti-adjustments',
		text: i18n.ts.preferences,
		to: '/settings/preferences',
		active: currentPage.value?.route.name === 'preferences',
	}, {
		icon: 'ti ti-palette',
		text: i18n.ts.theme,
		to: '/settings/theme',
		active: currentPage.value?.route.name === 'theme',
	}, {
		icon: 'ti ti-mood-happy',
		text: i18n.ts.emojiPalette,
		to: '/settings/emoji-palette',
		active: currentPage.value?.route.name === 'emoji-palette',
	}, {
		icon: 'ti ti-music',
		text: i18n.ts.sounds,
		to: '/settings/sounds',
		active: currentPage.value?.route.name === 'sounds',
	}, {
		icon: 'ti ti-plug',
		text: i18n.ts.plugins,
		to: '/settings/plugin',
		active: currentPage.value?.route.name === 'plugin',
	}],
}, {
	items: [{
		icon: 'ti ti-cloud',
		text: i18n.ts.drive,
		to: '/settings/drive',
		active: currentPage.value?.route.name === 'drive',
	}, {
		icon: 'ti ti-ban',
		text: i18n.ts.muteAndBlock,
		to: '/settings/mute-block',
		active: currentPage.value?.route.name === 'mute-block',
	}, {
		icon: 'ti ti-link',
		text: i18n.ts._settings.serviceConnection,
		to: '/settings/connect',
		active: currentPage.value?.route.name === 'connect',
	}, {
		icon: 'ti ti-package',
		text: i18n.ts._settings.accountData,
		to: '/settings/account-data',
		active: currentPage.value?.route.name === 'account-data',
	}, {
		icon: 'ti ti-dots',
		text: i18n.ts.other,
		to: '/settings/other',
		active: currentPage.value?.route.name === 'other',
	}],
}, {
	items: [{
		type: 'button',
		icon: 'ti ti-settings-2',
		text: i18n.ts.preferencesProfile,
		action: async (ev) => {
			os.popupMenu(getPreferencesProfileMenu(), ev.currentTarget ?? ev.target);
		},
	}, {
		type: 'button',
		icon: 'ti ti-trash',
		text: i18n.ts.clearCache,
		action: async () => {
			await clearCache();
		},
	}, {
		type: 'button',
		icon: 'ti ti-power',
		text: i18n.ts.logout,
		action: async () => {
			const { canceled } = await os.confirm({
				type: 'warning',
				title: i18n.ts.logoutConfirm,
				text: i18n.ts.logoutWillClearClientData,
			});
			if (canceled) return;
			signout();
		},
		danger: true,
	}],
}]);

/** 只在设置首页测量并沿用宽屏默认入口，其他页面不触发重定向。 */
function measureSettings(): void {
	if (!isSettingsRoute.value || el.value == null) return;
	narrow.value = el.value.offsetWidth < NARROW_THRESHOLD;
	if (!narrow.value && currentPage.value?.route.name == null) router.replace('/settings/profile');
}

watch(el,
	/** 跟随本地布局节点更换观察对象，覆盖首页与子页切换。 */
	(value: HTMLElement | null, previous: HTMLElement | null): void => {
		if (previous != null) ro.unobserve(previous);
		if (value != null) ro.observe(value);
	},
	{ flush: 'post' },
);
onMounted(measureSettings);
onActivated(measureSettings);
onUnmounted(
	/** 最终销毁时释放本页尺寸观察。 */
	(): void => { ro.disconnect(); },
);
watch(router.currentRef,
	/** 仅在有效设置首页执行既有宽屏入口导航。 */
	(to: PathResolvedResult): void => {
		if (to.route.name === 'settings' && to.child?.route.name == null && !narrow.value) {
			router.replace('/settings/profile');
		}
	},
);

const emailNotConfigured = computed(() => $i && instance.enableEmail && ($i.email == null || !$i.emailVerified));

provideMetadataReceiver((metadataGetter) => {
	const info = metadataGetter();
	if (info == null) {
		childInfo.value = null;
	} else {
		childInfo.value = info;
		INFO.value.needWideArea = info.needWideArea ?? undefined;
	}
});
provideReactiveMetadata(INFO);

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => INFO.value);
// w 890
// h 700
</script>

<style lang="scss" scoped>
.vvcocwet {
	&.wide {
		> .body {
			display: flex;
			height: 100%;

			> .nav {
				width: 34%;
				padding-right: 32px;
				box-sizing: border-box;
			}

			> .main {
				flex: 1;
				min-width: 0;
			}
		}
	}
}
</style>
