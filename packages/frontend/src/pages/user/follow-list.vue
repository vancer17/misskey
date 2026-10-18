<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<MkPagination v-slot="{items}" :paginator="type === 'following' ? followingPaginator : followersPaginator" withControl>
		<div :class="$style.users">
			<MkUserInfo v-for="user in items.map(x => type === 'following' ? x.followee! : x.follower!)" :key="user.id" :user="user"/>
		</div>
	</MkPagination>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, onActivated } from 'vue';
import * as Misskey from 'misskey-js';
import MkUserInfo from '@/components/MkUserInfo.vue';
import MkPagination from '@/components/MkPagination.vue';
import { Paginator } from '@/utility/paginator.js';

const props = defineProps<{
	user: Misskey.entities.User;
	type: 'following' | 'followers';
}>();

const followingPaginator = markRaw(new Paginator('users/following', {
	limit: 20,
	computedParams: computed(() => ({
		userId: props.user.id,
	})),
}));

const followersPaginator = markRaw(new Paginator('users/followers', {
	limit: 20,
	computedParams: computed(() => ({
		userId: props.user.id,
	})),
}));

/** KeepAlive 首次激活跳过标志（挂载期已完成首拉，防止双拉）。 */
let skipNextActivation = true;

/** 回访刷新（K-05：任意界面的 follow / unfollow 后回访列表不陈旧；
 *  仅重载当前 type 对应的活跃分页器，且仅有条目时执行）。 */
onActivated(() => {
	if (skipNextActivation) {
		skipNextActivation = false;
		return;
	}
	const paginator = props.type === 'following' ? followingPaginator : followersPaginator;
	if (paginator.items.value.length > 0) void paginator.reload();
});
</script>

<style lang="scss" module>
.users {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	grid-gap: var(--MI-margin);
}
</style>
