<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!--
Twitter UI 匿名欢迎页：只读消费既有实例模型，呈现本地品牌和真实认证入口。
布局尺度来自指定 X 归档；不加载旧访客仪表盘、统计、推荐或时间线。
认证仍由 Misskey 原组件负责，差异与来源见 anonymous-entry.md / ADR-0007。
-->
<template>
<div :class="[$style.root, { [$style.compact]: compact, [$style.split]: split }]" data-testid="twitter-welcome">
	<div :class="$style.content">
		<section :class="$style.formColumn" :aria-label="i18n.ts.login">
			<div :class="$style.panel" data-testid="twitter-entry-panel">
				<div v-if="!split" :class="$style.inlineBrand" aria-hidden="true">
					<img :src="instance.iconUrl || misskeyLogo" :class="$style.mark" alt=""/>
				</div>
				<h1 :class="$style.heading">{{ instance.name || instanceName }}</h1>
				<p :class="$style.description">{{ i18n.ts.headlineMisskey }}</p>
				<p v-if="instance.disableRegistration" :class="$style.notice" data-testid="twitter-invitation-notice">
					<i class="ti ti-info-circle" aria-hidden="true"></i> {{ i18n.ts.invitationRequiredToRegister }}
				</p>
				<TwitterAuthButtons/>
			</div>
		</section>
		<div v-if="split" :class="$style.brandColumn" aria-hidden="true" data-testid="twitter-entry-brand">
			<img :src="instance.iconUrl || misskeyLogo" :class="$style.brandImage" alt=""/>
		</div>
	</div>
	<footer :class="$style.footer">
		<MkA to="/about">{{ i18n.ts.about }}</MkA>
		<a v-if="instance.tosUrl" :href="instance.tosUrl" target="_blank" rel="noopener noreferrer">{{ i18n.ts.termsOfService }}</a>
		<a v-if="instance.privacyPolicyUrl" :href="instance.privacyPolicyUrl" target="_blank" rel="noopener noreferrer">{{ i18n.ts.privacyPolicy }}</a>
		<MkA to="/about-misskey">{{ i18n.ts.aboutMisskey }}</MkA>
	</footer>
</div>
</template>

<script lang="ts" setup>
import type * as Misskey from 'misskey-js';
import { instanceName } from '@@/js/config.js';
import { i18n } from '@/i18n.js';
import misskeyLogo from '/static-assets/icons/512.png';
import TwitterAuthButtons from './TwitterAuthButtons.vue';
import { useEntryLayout } from '../composables/use-entry-layout.js';

// 复用既有 MetaDetailed 权威模型，不创建入口 DTO 或本地实例副本。
defineProps<{ instance: Readonly<Misskey.entities.MetaDetailed> }>();
const { compact, split } = useEntryLayout();
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	min-height: 100%;
	background: var(--twitter-entry-bg);
	color: var(--twitter-entry-fg);
}
.content {
	display: flex;
	flex: 1;
	width: 100%;
	max-width: var(--twitter-entry-max-width);
	margin: 0 auto;
}
.formColumn {
	display: flex;
	flex: 1;
	min-width: 0;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	padding: var(--twitter-entry-block-padding) var(--twitter-space-4);
}
.panel {
	width: 100%;
	max-width: var(--twitter-entry-panel-width);
	overflow-wrap: anywhere;
}
.heading {
	margin: 0 0 var(--twitter-space-6);
	padding-bottom: var(--twitter-space-4);
	font-size: var(--twitter-entry-title-size);
	line-height: 0.9;
	font-weight: 600;
	text-align: center;
}
.description {
	margin: 0 0 var(--twitter-entry-action-gap);
	font-size: var(--twitter-font-size-heading);
	line-height: 1.3;
}
.notice {
	margin: 0 0 var(--twitter-entry-action-gap);
	font-size: var(--twitter-font-size-body);
	line-height: 1.5;
	color: var(--twitter-secondary-fg);
}
.inlineBrand {
	display: flex;
	align-items: center;
	justify-content: center;
	margin: 0 auto var(--twitter-space-4);
}
.mark {
	width: 100%;
	max-width: var(--twitter-entry-inline-logo-width);
	height: auto;
	object-fit: contain;
}
.brandColumn {
	display: flex;
	flex: 1;
	min-width: 0;
	min-height: 45vh;
	align-items: center;
	justify-content: center;
	overflow: hidden;
}
.brandImage {
	width: 100%;
	max-width: var(--twitter-entry-brand-width);
	height: auto;
	object-fit: contain;
}
.footer {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	gap: var(--twitter-space-1) var(--twitter-space-4);
	padding: var(--twitter-space-3) var(--twitter-space-4);
	padding-bottom: max(var(--twitter-space-3), env(safe-area-inset-bottom, 0px));
	font-size: var(--twitter-font-size-meta);
	line-height: 1.5;
	color: var(--twitter-secondary-fg);

	a:hover { text-decoration: underline; }
	a:focus-visible { outline: 2px solid var(--twitter-accent); }
}
.split {
	.formColumn {
		justify-content: flex-start;
		padding-inline-start: var(--twitter-entry-start-padding);
	}
	.heading {
		font-size: var(--twitter-entry-title-size-wide);
		letter-spacing: -1px;
		text-align: start;
	}
}
.compact {
	.formColumn { padding-inline: var(--twitter-space-6); }
	.inlineBrand { min-height: 30vh; }
	.mark { max-width: var(--twitter-entry-compact-logo-width); }
	.heading {
		font-size: var(--twitter-font-size-heading);
		line-height: 1.3;
	}
	.description { font-size: var(--twitter-font-size-content); }
}
</style>
