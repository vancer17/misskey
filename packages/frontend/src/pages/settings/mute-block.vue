<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：Compatible 屏蔽与拉黑设置。
作用：在原命令成功后更新原数据源，回访仍保留当前显示上下文。
数据链：命令确认 → 原分页器／实体 → 只读组件；不写入第二份业务事实。
-->

<template>
<SearchMarker path="/settings/mute-block" :label="i18n.ts.muteAndBlock" icon="ti ti-ban" :keywords="['mute', 'block']">
	<div class="_gaps_m">
		<MkFeatureBanner icon="/fluent-emoji/1f6ab.png" color="#ff2600">
			<SearchText>{{ i18n.ts._settings.muteAndBlockBanner }}</SearchText>
		</MkFeatureBanner>

		<div class="_gaps_s">
			<SearchMarker
				:label="i18n.ts.wordMute"
				:keywords="['note', 'word', 'soft', 'mute', 'hide']"
			>
				<MkFolder>
					<template #icon><i class="ti ti-message-off"></i></template>
					<template #label>{{ i18n.ts.wordMute }}</template>

					<div class="_gaps_m">
						<MkInfo>{{ i18n.ts.wordMuteDescription }}</MkInfo>

						<SearchMarker
							:label="i18n.ts.showMutedWord"
							:keywords="['show']"
						>
							<MkSwitch v-model="showSoftWordMutedWord">{{ i18n.ts.showMutedWord }}</MkSwitch>
						</SearchMarker>

						<XWordMute :muted="$i.mutedWords" @save="saveMutedWords"/>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker
				:label="i18n.ts.hardWordMute"
				:keywords="['note', 'word', 'hard', 'mute', 'hide']"
			>
				<MkFolder>
					<template #icon><i class="ti ti-message-off"></i></template>
					<template #label>{{ i18n.ts.hardWordMute }}</template>

					<div class="_gaps_m">
						<MkInfo>{{ i18n.ts.hardWordMuteDescription }}</MkInfo>
						<XWordMute :muted="$i.hardMutedWords" @save="saveHardMutedWords"/>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker
				:label="i18n.ts.emojiMute"
				:keywords="['emoji', 'mute', 'hide']"
			>
				<MkFolder>
					<template #icon><i class="ti ti-mood-off"></i></template>
					<template #label>{{ i18n.ts.emojiMute }}</template>

					<XEmojiMute/>
				</mkfolder>
			</SearchMarker>

			<SearchMarker
				:label="i18n.ts.instanceMute"
				:keywords="['note', 'server', 'instance', 'host', 'federation', 'mute', 'hide']"
			>
				<MkFolder v-if="instance.federation !== 'none'">
					<template #icon><i class="ti ti-planet-off"></i></template>
					<template #label>{{ i18n.ts.instanceMute }}</template>

					<XInstanceMute/>
				</MkFolder>
			</SearchMarker>

			<SearchMarker
				:keywords="['renote', 'mute', 'hide', 'user']"
			>
				<MkFolder>
					<template #icon><i class="ti ti-repeat-off"></i></template>
					<template #label><SearchLabel>{{ i18n.ts.mutedUsers }} ({{ i18n.ts.renote }})</SearchLabel></template>

					<MkPagination :paginator="renoteMutingPaginator" withControl>
						<template #empty><MkResult type="empty" :text="i18n.ts.noUsers"/></template>

						<template #default="{ items }">
							<div class="_gaps_s">
								<div v-for="item in items" :key="item.mutee.id" :class="[$style.userItem, { [$style.userItemOpend]: expandedRenoteMuteItems.includes(item.id) }]">
									<div :class="$style.userItemMain">
										<MkA :class="$style.userItemMainBody" :to="userPage(item.mutee)">
											<MkUserCardMini :user="item.mutee"/>
										</MkA>
										<button class="_button" :class="$style.userToggle" @click="toggleRenoteMuteItem(item)"><i :class="$style.chevron" class="ti ti-chevron-down"></i></button>
										<button class="_button" :class="$style.remove" @click="unrenoteMute(item.mutee, $event)"><i class="ti ti-x"></i></button>
									</div>
									<div v-if="expandedRenoteMuteItems.includes(item.id)" :class="$style.userItemSub">
										<div>Muted at: <MkTime :time="item.createdAt" mode="detail"/></div>
									</div>
								</div>
							</div>
						</template>
					</MkPagination>
				</MkFolder>
			</SearchMarker>

			<SearchMarker
				:label="i18n.ts.mutedUsers"
				:keywords="['note', 'mute', 'hide', 'user']"
			>
				<MkFolder>
					<template #icon><i class="ti ti-eye-off"></i></template>
					<template #label>{{ i18n.ts.mutedUsers }}</template>

					<MkPagination :paginator="mutingPaginator" withControl>
						<template #empty><MkResult type="empty" :text="i18n.ts.noUsers"/></template>

						<template #default="{ items }">
							<div class="_gaps_s">
								<div v-for="item in items" :key="item.mutee.id" :class="[$style.userItem, { [$style.userItemOpend]: expandedMuteItems.includes(item.id) }]">
									<div :class="$style.userItemMain">
										<MkA :class="$style.userItemMainBody" :to="userPage(item.mutee)">
											<MkUserCardMini :user="item.mutee"/>
										</MkA>
										<button class="_button" :class="$style.userToggle" @click="toggleMuteItem(item)"><i :class="$style.chevron" class="ti ti-chevron-down"></i></button>
										<button class="_button" :class="$style.remove" @click="unmute(item.mutee, $event)"><i class="ti ti-x"></i></button>
									</div>
									<div v-if="expandedMuteItems.includes(item.id)" :class="$style.userItemSub">
										<div>Muted at: <MkTime :time="item.createdAt" mode="detail"/></div>
										<div v-if="item.expiresAt">Period: {{ new Date(item.expiresAt).toLocaleString() }}</div>
										<div v-else>Period: {{ i18n.ts.indefinitely }}</div>
									</div>
								</div>
							</div>
						</template>
					</MkPagination>
				</MkFolder>
			</SearchMarker>

			<SearchMarker
				:label="i18n.ts.blockedUsers"
				:keywords="['block', 'user']"
			>
				<MkFolder>
					<template #icon><i class="ti ti-ban"></i></template>
					<template #label>{{ i18n.ts.blockedUsers }}</template>

					<MkPagination :paginator="blockingPaginator" withControl>
						<template #empty><MkResult type="empty" :text="i18n.ts.noUsers"/></template>

						<template #default="{ items }">
							<div class="_gaps_s">
								<div v-for="item in items" :key="item.blockee.id" :class="[$style.userItem, { [$style.userItemOpend]: expandedBlockItems.includes(item.id) }]">
									<div :class="$style.userItemMain">
										<MkA :class="$style.userItemMainBody" :to="userPage(item.blockee)">
											<MkUserCardMini :user="item.blockee"/>
										</MkA>
										<button class="_button" :class="$style.userToggle" @click="toggleBlockItem(item)"><i :class="$style.chevron" class="ti ti-chevron-down"></i></button>
										<button class="_button" :class="$style.remove" @click="unblock(item.blockee, $event)"><i class="ti ti-x"></i></button>
									</div>
									<div v-if="expandedBlockItems.includes(item.id)" :class="$style.userItemSub">
										<div>Blocked at: <MkTime :time="item.createdAt" mode="detail"/></div>
									</div>
								</div>
							</div>
						</template>
					</MkPagination>
				</MkFolder>
			</SearchMarker>
		</div>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { useTwitterPaginatorRefresh } from '@/ui/twitter/index.js';
import { ref, computed, watch, markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import XEmojiMute from './mute-block.emoji-mute.vue';
import XInstanceMute from './mute-block.instance-mute.vue';
import XWordMute from './mute-block.word-mute.vue';
import MkPagination from '@/components/MkPagination.vue';
import { userPage } from '@/filters/user.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import * as os from '@/os.js';
import { instance } from '@/instance.js';
import { ensureSignin } from '@/i.js';
import MkInfo from '@/components/MkInfo.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import { prefer } from '@/preferences.js';
import MkFeatureBanner from '@/components/MkFeatureBanner.vue';
import { Paginator } from '@/utility/paginator.js';
import { suggestReload } from '@/utility/reload-suggest.js';

const $i = ensureSignin();

const renoteMutingPaginator = markRaw(new Paginator('renote-mute/list', {
	limit: 10,
}));

const mutingPaginator = markRaw(new Paginator('mute/list', {
	limit: 10,
}));

const blockingPaginator = markRaw(new Paginator('blocking/list', {
	limit: 10,
}));

/** 关系集合各自拥有成功后的刷新入口，不根据用户 ID 猜测关系记录 ID。 */
const invalidateRenoteMutes: () => void = useTwitterPaginatorRefresh(/** 转发屏蔽集合。 */ (): typeof renoteMutingPaginator => renoteMutingPaginator);
const invalidateMutes: () => void = useTwitterPaginatorRefresh(/** 屏蔽集合。 */ (): typeof mutingPaginator => mutingPaginator);
const invalidateBlocks: () => void = useTwitterPaginatorRefresh(/** 拉黑集合。 */ (): typeof blockingPaginator => blockingPaginator);

const expandedRenoteMuteItems = ref<string[]>([]);
const expandedMuteItems = ref<string[]>([]);
const expandedBlockItems = ref<string[]>([]);

const showSoftWordMutedWord = prefer.model('showSoftWordMutedWord');

watch([
	showSoftWordMutedWord,
], () => {
	suggestReload();
});

/** 解除关系确认后重取原集合，失败不删除当前显示项。 */
async function unrenoteMute(user: Misskey.entities.UserDetailed, ev: PointerEvent): Promise<void> {
	os.popupMenu([{
		text: i18n.ts.renoteUnmute,
		icon: 'ti ti-x',
		action: /** 提交服务端命令，成功才产生刷新意图。 */ async (): Promise<void> => {
			await os.apiWithDialog('renote-mute/delete', { userId: user.id }).then(
				/** 确认解除后才更新原集合。 */ (): void => { invalidateRenoteMutes(); },
				/** 原对话框已显示错误；失败不移除关系，也不产生未处理拒绝。 */ (): void => {},
			);
		},
	}], ev.currentTarget ?? ev.target);
}

/** 解除关系确认后重取原集合，失败不删除当前显示项。 */
async function unmute(user: Misskey.entities.UserDetailed, ev: PointerEvent): Promise<void> {
	os.popupMenu([{
		text: i18n.ts.unmute,
		icon: 'ti ti-x',
		action: /** 提交服务端命令，成功才产生刷新意图。 */ async (): Promise<void> => {
			await os.apiWithDialog('mute/delete', { userId: user.id }).then(
				/** 确认解除后才更新原集合。 */ (): void => { invalidateMutes(); },
				/** 原对话框已显示错误；失败不移除关系，也不产生未处理拒绝。 */ (): void => {},
			);
		},
	}], ev.currentTarget ?? ev.target);
}

/** 解除关系确认后重取原集合，失败不删除当前显示项。 */
async function unblock(user: Misskey.entities.UserDetailed, ev: PointerEvent): Promise<void> {
	os.popupMenu([{
		text: i18n.ts.unblock,
		icon: 'ti ti-x',
		action: /** 提交服务端命令，成功才产生刷新意图。 */ async (): Promise<void> => {
			await os.apiWithDialog('blocking/delete', { userId: user.id }).then(
				/** 确认解除后才更新原集合。 */ (): void => { invalidateBlocks(); },
				/** 原对话框已显示错误；失败不移除关系，也不产生未处理拒绝。 */ (): void => {},
			);
		},
	}], ev.currentTarget ?? ev.target);
}

async function toggleRenoteMuteItem(item: { id: string }) {
	if (expandedRenoteMuteItems.value.includes(item.id)) {
		expandedRenoteMuteItems.value = expandedRenoteMuteItems.value.filter(x => x !== item.id);
	} else {
		expandedRenoteMuteItems.value.push(item.id);
	}
}

async function toggleMuteItem(item: { id: string }) {
	if (expandedMuteItems.value.includes(item.id)) {
		expandedMuteItems.value = expandedMuteItems.value.filter(x => x !== item.id);
	} else {
		expandedMuteItems.value.push(item.id);
	}
}

async function toggleBlockItem(item: { id: string }) {
	if (expandedBlockItems.value.includes(item.id)) {
		expandedBlockItems.value = expandedBlockItems.value.filter(x => x !== item.id);
	} else {
		expandedBlockItems.value.push(item.id);
	}
}

async function saveMutedWords(mutedWords: (string | string[])[]) {
	await os.apiWithDialog('i/update', { mutedWords });
}

async function saveHardMutedWords(hardMutedWords: (string | string[])[]) {
	await os.apiWithDialog('i/update', { hardMutedWords });
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.muteAndBlock,
	icon: 'ti ti-ban',
}));
</script>

<style lang="scss" module>
.userItemMain {
	display: flex;
}

.userItemSub {
	padding: 6px 12px;
	font-size: 85%;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}

.userItemMainBody {
	flex: 1;
	min-width: 0;
	margin-right: 8px;

	&:hover {
		text-decoration: none;
	}
}

.userToggle,
.remove {
	width: 32px;
	height: 32px;
	align-self: center;
}

.chevron {
	display: block;
	transition: transform 0.1s ease-out;
}

.userItem.userItemOpend {
	.chevron {
		transform: rotateX(180deg);
	}
}
</style>
