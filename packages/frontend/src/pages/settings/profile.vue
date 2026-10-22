<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
文件领域：个人资料编辑页面。
作用：保留 Misskey 既有表单、文件选择和校验，服务端确认后通过账户更新入口提交状态。
数据链：临时表单 → 串行保存请求 → 已确认账户单例；展示不将草稿当作业务事实。
-->

<template>
<SearchMarker path="/settings/profile" :label="i18n.ts.profile" :keywords="['profile']" icon="ti ti-user">
	<div
		:class="isTwitterUi ? [$style.twitterRoot, { [$style.mobile]: isMobile }] : '_gaps_m'"
	>
		<!-- 身份块：Twitter 分支还原 nitter profile 卡惯例（banner 3:1 + 卡身 12px + 头像 ring 入流，
			无控件叠压头像 / banner；变更入口为按钮行，nitter 无编辑器对应物故复用既有 MkButton） -->
		<section v-if="isTwitterUi" :class="[$style.twitterCard, $style.twitterIdentityCard]">
			<div :class="$style.twitterBanner" :style="bannerStyle" role="presentation"></div>
			<div :class="$style.twitterIdentityBody">
				<TwitterAvatar decorationContext="none" :class="$style.twitterAvatar" :user="$i"/>
				<div :class="$style.twitterIdentityButtons">
					<MkButton primary rounded data-testid="profile-change-banner" @click="changeBanner">{{ i18n.ts._profile.changeBanner }}</MkButton>
					<MkButton primary rounded data-testid="profile-change-avatar" @click="changeAvatar">{{ i18n.ts._profile.changeAvatar }}</MkButton>
					<MkButton rounded type="routerLink" to="/settings/avatar-decoration">{{ i18n.ts.decorate }} <i class="ti ti-sparkles"></i></MkButton>
				</div>
			</div>
		</section>
		<div v-else class="_panel">
			<div :class="$style.banner" :style="bannerStyle">
				<div :class="$style.bannerEdit">
					<SearchMarker :keywords="['banner', 'change']">
						<MkButton primary rounded data-testid="profile-change-banner" @click="changeBanner"><SearchLabel>{{ i18n.ts._profile.changeBanner }}</SearchLabel></MkButton>
					</SearchMarker>
				</div>
			</div>
			<div :class="$style.avatarContainer">
				<MkAvatar :class="$style.avatar" :user="$i" forceShowDecoration @click="changeAvatar"/>
				<div class="_buttonsCenter">
					<SearchMarker :keywords="['avatar', 'icon', 'change']">
						<MkButton primary rounded data-testid="profile-change-avatar" @click="changeAvatar"><SearchLabel>{{ i18n.ts._profile.changeAvatar }}</SearchLabel></MkButton>
					</SearchMarker>
					<MkButton primary rounded type="routerLink" to="/settings/avatar-decoration">{{ i18n.ts.decorate }} <i class="ti ti-sparkles"></i></MkButton>
				</div>
			</div>
		</div>

		<!-- 主字段组（name / bio）：Twitter 分支为 token 卡片，控件本体共享（Core 级主工作流） -->
		<div :class="isTwitterUi ? $style.twitterCard : '_gaps_m'">
		<SearchMarker :keywords="['name']">
			<MkInput v-model="profile.name" data-testid="profile-name" :max="30" manualSave :mfmAutocomplete="['emoji']">
				<template #label><SearchLabel>{{ i18n.ts._profile.name }}</SearchLabel></template>
			</MkInput>
		</SearchMarker>

		<SearchMarker :keywords="['description', 'bio']">
			<MkTextarea v-model="profile.description" :max="500" tall manualSave mfmAutocomplete :mfmPreview="true">
				<template #label><SearchLabel>{{ i18n.ts._profile.description }}</SearchLabel></template>
				<template #caption>{{ i18n.ts._profile.youCanIncludeHashtags }}</template>
			</MkTextarea>
		</SearchMarker>
		</div>

		<!-- 次要控件组：Twitter 分支为 token 卡片，控件本体共享（Core 级基础兼容） -->
		<div :class="isTwitterUi ? $style.twitterCard : '_gaps_m'">
		<SearchMarker :keywords="['location', 'locale']">
			<MkInput v-model="profile.location" manualSave>
				<template #label><SearchLabel>{{ i18n.ts.location }}</SearchLabel></template>
				<template #prefix><i class="ti ti-map-pin"></i></template>
			</MkInput>
		</SearchMarker>

		<SearchMarker :keywords="['birthday', 'birthdate', 'age']">
			<MkInput v-model="profile.birthday" type="date" manualSave>
				<template #label><SearchLabel>{{ i18n.ts.birthday }}</SearchLabel></template>
				<template #prefix><i class="ti ti-cake"></i></template>
			</MkInput>
		</SearchMarker>

		<SearchMarker :keywords="['language', 'locale']">
			<MkSelect v-model="profile.lang" :items="Object.entries(langmap).map(([code, def]) => ({ label: def.nativeName, value: code }))">
				<template #label><SearchLabel>{{ i18n.ts.language }}</SearchLabel></template>
			</MkSelect>
		</SearchMarker>

		<SearchMarker :keywords="['metadata']">
			<FormSlot>
				<MkFolder>
					<template #icon><i class="ti ti-list"></i></template>
					<template #label><SearchLabel>{{ i18n.ts._profile.metadataEdit }}</SearchLabel></template>
					<template #footer>
						<div class="_buttons">
							<MkButton primary @click="saveFields"><i class="ti ti-check"></i> {{ i18n.ts.save }}</MkButton>
							<MkButton :disabled="fields.length >= 16" @click="addField"><i class="ti ti-plus"></i> {{ i18n.ts.add }}</MkButton>
							<MkButton v-if="!fieldEditMode" :disabled="fields.length <= 1" danger @click="fieldEditMode = !fieldEditMode"><i class="ti ti-trash"></i> {{ i18n.ts.delete }}</MkButton>
							<MkButton v-else @click="fieldEditMode = !fieldEditMode"><i class="ti ti-arrows-sort"></i> {{ i18n.ts.rearrange }}</MkButton>
						</div>
					</template>

					<div :class="$style.metadataRoot" class="_gaps_s">
						<MkInfo>{{ i18n.ts._profile.verifiedLinkDescription }}</MkInfo>

						<MkDraggable
							v-model="fields"
							direction="vertical"
							withGaps
							manualDragStart
						>
							<template #default="{ item, dragStart }">
								<div v-panel :class="$style.fieldDragItem">
									<button v-if="!fieldEditMode" class="_button" :class="$style.dragItemHandle" tabindex="-1" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-menu"></i></button>
									<button v-if="fieldEditMode" :disabled="fields.length <= 1" class="_button" :class="$style.dragItemRemove" @click="deleteField(item.id)"><i class="ti ti-x"></i></button>
									<div :class="$style.dragItemForm">
										<FormSplit :minWidth="200">
											<MkInput v-model="item.name" small :placeholder="i18n.ts._profile.metadataLabel">
											</MkInput>
											<MkInput v-model="item.value" small :placeholder="i18n.ts._profile.metadataContent">
											</MkInput>
										</FormSplit>
									</div>
								</div>
							</template>
						</MkDraggable>
					</div>
				</MkFolder>
				<template #caption>{{ i18n.ts._profile.metadataDescription }}</template>
			</FormSlot>
		</SearchMarker>

		<SearchMarker :keywords="['follow', 'message']">
			<MkInput v-model="profile.followedMessage" :max="200" manualSave :mfmPreview="false">
				<template #label><SearchLabel>{{ i18n.ts._profile.followedMessage }}</SearchLabel></template>
				<template #caption>
					<div><SearchText>{{ i18n.ts._profile.followedMessageDescription }}</SearchText></div>
					<div>{{ i18n.ts._profile.followedMessageDescriptionForLockedAccount }}</div>
				</template>
			</MkInput>
		</SearchMarker>

		<SearchMarker :keywords="['reaction']">
			<MkSelect
				v-model="reactionAcceptance"
				:items="[
					{ label: i18n.ts.all, value: null },
					{ label: i18n.ts.likeOnlyForRemote, value: 'likeOnlyForRemote' },
					{ label: i18n.ts.nonSensitiveOnly, value: 'nonSensitiveOnly' },
					{ label: i18n.ts.nonSensitiveOnlyForLocalLikeOnlyForRemote, value: 'nonSensitiveOnlyForLocalLikeOnlyForRemote' },
					{ label: i18n.ts.likeOnly, value: 'likeOnly' },
				]"
			>
				<template #label><SearchLabel>{{ i18n.ts.reactionAcceptance }}</SearchLabel></template>
			</MkSelect>
		</SearchMarker>

		<SearchMarker>
			<MkFolder>
				<template #label><SearchLabel>{{ i18n.ts.advancedSettings }}</SearchLabel></template>

				<div class="_gaps_m">
					<SearchMarker :keywords="['cat']">
						<MkSwitch v-model="profile.isCat">
							<template #label><SearchLabel>{{ i18n.ts.flagAsCat }}</SearchLabel></template>
							<template #caption>{{ i18n.ts.flagAsCatDescription }}</template>
						</MkSwitch>
					</SearchMarker>

					<SearchMarker :keywords="['bot']">
						<MkSwitch v-model="profile.isBot">
							<template #label><SearchLabel>{{ i18n.ts.flagAsBot }}</SearchLabel></template>
							<template #caption>{{ i18n.ts.flagAsBotDescription }}</template>
						</MkSwitch>
					</SearchMarker>
				</div>
			</MkFolder>
		</SearchMarker>

		<hr>

		<SearchMarker :keywords="['qrcode']">
			<FormLink to="/qr">
				<template #icon><i class="ti ti-qrcode"></i></template>
				<SearchLabel>{{ i18n.ts.qr }}</SearchLabel>
			</FormLink>
		</SearchMarker>
		</div>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, inject, reactive, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkSelect from '@/components/MkSelect.vue';
import FormSplit from '@/components/form/split.vue';
import MkFolder from '@/components/MkFolder.vue';
import FormSlot from '@/components/form/slot.vue';
import FormLink from '@/components/form/link.vue';
import MkDraggable from '@/components/MkDraggable.vue';
import { chooseDriveFile } from '@/utility/drive.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import { updateCurrentAccountPartial } from '@/accounts.js';
import { langmap } from '@/utility/langmap.js';
import { definePage } from '@/page.js';
import { claimAchievement } from '@/utility/achievements.js';
import { store } from '@/store.js';
import MkInfo from '@/components/MkInfo.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import { genId } from '@/utility/id.js';
import { DI } from '@/di.js';
import { TwitterAvatar } from '@/ui/twitter/index.js';
import { useTwitterLayout } from '@/ui/twitter/context/index.js';

const $i = ensureSignin();

/** 当前 UI 样式（由 Twitter Shell 注入；非 Twitter 场景回退 'default'）。 */
const uiStyle = inject(DI.uiStyle, ref('default'));
const isTwitterUi = computed(() => uiStyle.value === 'twitter');

/** Twitter 布局状态（移动端 class 驱动，ADR-0001 决策 4）。 */
const { isMobile } = useTwitterLayout();

/** banner 背景样式（Twitter / legacy 分支共用，单一来源派生）。 */
const bannerStyle = computed<{ backgroundImage?: string }>(() => {
	if ($i.bannerUrl == null) return {};
	return { backgroundImage: `url(${$i.bannerUrl})` };
});

const reactionAcceptance = store.model('reactionAcceptance');

function assertVaildLang(lang: string | null): lang is keyof typeof langmap {
	return lang != null && lang in langmap;
}

const profile = reactive({
	name: $i.name,
	description: $i.description,
	followedMessage: $i.followedMessage,
	location: $i.location,
	birthday: $i.birthday,
	lang: assertVaildLang($i.lang) ? $i.lang : null,
	isBot: $i.isBot ?? false,
	isCat: $i.isCat ?? false,
});

watch(profile,
	/** 手动保存控件提交 v-model 后等待整条保存链路，不使用悬空 Promise。 */
	async (): Promise<void> => { await save(); },
	{ deep: true },
);

const fields = ref($i.fields.map(field => ({ id: genId(), name: field.name, value: field.value })) ?? []);
const fieldEditMode = ref(false);

function addField() {
	fields.value.push({
		id: genId(),
		name: '',
		value: '',
	});
}

while (fields.value.length < 4) {
	addField();
}

function deleteField(itemId: string) {
	fields.value = fields.value.filter(f => f.id !== itemId);
}

/** 保存命令串行执行，防止旧请求晚到覆盖后一次编辑；不存放账户事实。 */
let profileSaveQueue: Promise<void> = Promise.resolve();

/** 仅将服务端确认的结果提交到 Misskey 既有账户更新入口。 */
function saveProfileChanges(
	changes: Misskey.Endpoints['i/update']['req'],
	customErrors?: os.ApiWithDialogCustomErrors,
): Promise<boolean> {
	const result: Promise<boolean> = profileSaveQueue.then(
		/** 保持同一编辑器内各次服务端写入及账户回填的顺序。 */
		async (): Promise<boolean> => {
			const saved: Misskey.entities.MeDetailed | null = await os.apiWithDialog('i/update', changes, undefined, customErrors).catch(
				/** 请求错误已由 apiWithDialog 呈现，失败不提交草稿或伪造成功。 */
				(): null => null,
			);
			if (saved == null) return false;
			updateCurrentAccountPartial(saved);
			return true;
		},
	);
	profileSaveQueue = result.then(
		/** 释放成功命令占用，下一条命令可以执行。 */
		(): void => {},
		/** 队列不因异常永久中断；原 result 仍向调用方传播异常。 */
		(): void => {},
	);
	return result;
}

/** 将扩展字段草稿序列化后提交，账户展示仅消费服务端确认值。 */
async function saveFields(): Promise<void> {
	await saveProfileChanges({
		fields: fields.value.filter(
			/** 空白表单行不是已保存字段。 */
			(field: (typeof fields.value)[number]): boolean => field.name !== '' && field.value !== '',
		).map(
			/** 移除临时 UI 行标识，保持原请求 Schema。 */
			(field: (typeof fields.value)[number]): { name: string; value: string } => ({ name: field.name, value: field.value }),
		),
	});
}

/** 保存基本资料的值快照，成功后才执行原有成就逻辑。 */
async function save(): Promise<void> {
	const changes: Misskey.Endpoints['i/update']['req'] = {
		// 请求契约中空字符串规范化为 null，而不是缺省值。
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		name: profile.name || null,
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		description: profile.description || null,
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		followedMessage: profile.followedMessage || null,
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		location: profile.location || null,
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		birthday: profile.birthday || null,
		// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
		lang: profile.lang || null,
		isBot: !!profile.isBot,
		isCat: !!profile.isCat,
	};
	const saved: boolean = await saveProfileChanges(changes, {
		/** 保持原资料名称校验的错误提示。 */
		'0b3f9f6a-2f4d-4b1f-9fb4-49d3a2fd7191': {
			title: i18n.ts.yourNameContainsProhibitedWords,
			text: i18n.ts.yourNameContainsProhibitedWordsDescription,
		},
	});
	if (!saved) return;
	claimAchievement('profileFilled');
	if (changes.name === 'syuilo' || changes.name === 'しゅいろ') claimAchievement('setNameToSyuilo');
	if (changes.isCat) claimAchievement('markedAsCat');
}

/** 保留原头像文件选择流程，等待保存及既有账户状态提交完成。 */
function changeAvatar(ev: PointerEvent): void {
	/** 将已上传或云盘已有文件的标识提交，头像附属元数据来自服务端。 */
	async function done(driveFile: Misskey.entities.DriveFile): Promise<void> {
		if (await saveProfileChanges({ avatarId: driveFile.id })) claimAchievement('profileFilled');
	}

	os.popupMenu([{
		text: i18n.ts.avatar,
		type: 'label',
	}, {
		text: i18n.ts.upload,
		icon: 'ti ti-upload',
		/** 选择、裁剪、上传与保存按原顺序等待，取消不产生写入。 */
		action: async (): Promise<void> => {
			const files: Awaited<ReturnType<typeof os.chooseFileFromPc>> = await os.chooseFileFromPc({ multiple: false });
			const file: File | undefined = files[0];
			if (file == null) return;
			let originalOrCropped: File = file;
			const { canceled }: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({
				type: 'question', text: i18n.ts.cropImageAsk, okText: i18n.ts.cropYes, cancelText: i18n.ts.cropNo,
			});
			if (!canceled) originalOrCropped = await os.cropImageFile(file, { aspectRatio: 1 });
			const uploaded: Misskey.entities.DriveFile[] = await os.launchUploader([originalOrCropped], { multiple: false });
			const driveFile: Misskey.entities.DriveFile | undefined = uploaded[0];
			if (driveFile != null) await done(driveFile);
		},
	}, {
		text: i18n.ts.fromDrive,
		icon: 'ti ti-cloud',
		/** 云盘选择取消时无操作，选择成功后等待完整保存链路。 */
		action: async (): Promise<void> => {
			const files: Misskey.entities.DriveFile[] = await chooseDriveFile({ multiple: false });
			const file: Misskey.entities.DriveFile | undefined = files[0];
			if (file != null) await done(file);
		},
	}], ev.currentTarget ?? ev.target);
}

/** 保留原横幅选择流程，与其他资料写入共用串行提交入口。 */
function changeBanner(ev: PointerEvent): void {
	/** 只提交横幅文件标识，URL 与附属状态使用服务端确认结果。 */
	async function done(driveFile: Misskey.entities.DriveFile): Promise<void> {
		await saveProfileChanges({ bannerId: driveFile.id });
	}

	os.popupMenu([{
		text: i18n.ts.banner,
		type: 'label',
	}, {
		text: i18n.ts.upload,
		icon: 'ti ti-upload',
		/** 保留横幅原裁剪比例，顺序等待上传和保存完成。 */
		action: async (): Promise<void> => {
			const files: Awaited<ReturnType<typeof os.chooseFileFromPc>> = await os.chooseFileFromPc({ multiple: false });
			const file: File | undefined = files[0];
			if (file == null) return;
			let originalOrCropped: File = file;
			const { canceled }: Awaited<ReturnType<typeof os.confirm>> = await os.confirm({
				type: 'question', text: i18n.ts.cropImageAsk, okText: i18n.ts.cropYes, cancelText: i18n.ts.cropNo,
			});
			if (!canceled) originalOrCropped = await os.cropImageFile(file, { aspectRatio: 2 });
			const uploaded: Misskey.entities.DriveFile[] = await os.launchUploader([originalOrCropped], { multiple: false });
			const driveFile: Misskey.entities.DriveFile | undefined = uploaded[0];
			if (driveFile != null) await done(driveFile);
		},
	}, {
		text: i18n.ts.fromDrive,
		icon: 'ti ti-cloud',
		/** 已有云盘文件按相同保存契约处理。 */
		action: async (): Promise<void> => {
			const files: Misskey.entities.DriveFile[] = await chooseDriveFile({ multiple: false });
			const file: Misskey.entities.DriveFile | undefined = files[0];
			if (file != null) await done(file);
		},
	}], ev.currentTarget ?? ev.target);
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.profile,
	icon: 'ti ti-user',
}));
</script>

<style lang="scss" module>
.banner {
	position: relative;
	height: 130px;
	background-size: cover;
	background-position: center;
	border-bottom: solid 1px var(--MI_THEME-divider);
	overflow: clip;
}

.avatarContainer {
	margin-top: -50px;
	padding-bottom: 16px;
	text-align: center;
}

.avatar {
	display: inline-block;
	width: 72px;
	height: 72px;
	margin: 0 auto 16px auto;
}

.bannerEdit {
	position: absolute;
	top: 16px;
	right: 16px;
}

.metadataRoot {
	container-type: inline-size;
}

.fieldDragItem {
	display: flex;
	padding: 10px;
	align-items: flex-end;
	border-radius: 6px;

	/* (drag button) 32px + (drag button margin) 8px + (input width) 200px * 2 + (input gap) 12px = 452px */
	@container (max-width: 452px) {
		align-items: center;
	}
}

.dragItemHandle {
	cursor: grab;
	width: 32px;
	height: 32px;
	margin: 0 8px 0 0;
	opacity: 0.5;
	flex-shrink: 0;

	&:active {
		cursor: grabbing;
	}
}

.dragItemRemove {
	@extend .dragItemHandle;

	color: #ff2a2a;
	opacity: 1;
	cursor: pointer;

	&:hover, &:focus {
		opacity: .7;
	}

	&:active {
		cursor: pointer;
	}
}

.dragItemForm {
	flex-grow: 1;
}

/* ---- Twitter 分支（P-11，Core）----
 * 卡片：twitter token 面板 + hairline。身份块还原 nitter profile 卡惯例：
 * .profile-banner（3:1、bg 回退、下缘 4px）+ .profile-card（padding 12px、
 * 头像 ring 4px 入流、无控件叠压）；nitter 无资料编辑器，变更按钮复用 MkButton。 */
.twitterRoot {
	display: grid;
	gap: var(--twitter-space-4);
	padding: var(--twitter-space-4);

	&.mobile {
		gap: var(--twitter-space-3);
		padding: var(--twitter-space-3);

		.twitterAvatar {
			/* nitter 移动 ring 收窄为 2px（profile/card.scss @media 700px） */
			border-width: 2px;
		}
	}
}

.twitterCard {
	display: grid;
	gap: var(--twitter-space-4);
	padding: var(--twitter-space-4);
	background: var(--twitter-panel);
	border: solid 1px var(--twitter-border);
	border-radius: var(--twitter-radius-medium);
}

/* 身份卡：banner 通栏（与 TwitterHome banner 同为 3:1 / max 200px） */
.twitterIdentityCard {
	gap: 0;
	padding: 0;
	overflow: clip;
}

.twitterIdentityBody {
	display: grid;
	justify-items: center;
	gap: var(--twitter-space-3);
	padding: var(--twitter-space-3);
}

.twitterBanner {
	position: relative;
	display: block;
	width: 100%;
	aspect-ratio: 3 / 1;
	max-height: 200px;
	margin-bottom: var(--twitter-space-1);
	background-color: color-mix(in srgb, var(--twitter-fg) 10%, var(--twitter-bg));
	background-position: center;
	background-size: cover;
}

.twitterIdentityButtons {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: var(--twitter-space-2);
}

/* 头像：入流不叠压；ring 与 TwitterHome 同一 token 化惯例（nitter
 * .profile-card-avatar：ring 4px，移动 2px）。容器不加不透明底色——
 * nitter 的底色语义在 img 本体，此处由 MkAvatar 自身占位层承担；
 * 容器底色会把图片层未绘制状态伪装成灰色实心头像 */
.twitterAvatar {
	display: block;
	width: 80px;
	height: 80px;
	border: solid 4px var(--twitter-bg);
}
</style>
