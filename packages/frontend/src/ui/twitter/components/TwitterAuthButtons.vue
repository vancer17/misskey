<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- Twitter 认证入口业务组件：只调度既有登录／注册流程，不复制凭据、表单状态或接口实现。 -->
<template>
<div :class="[$style.root, { [$style.compact]: compact }]">
	<button class="_button" :class="[$style.action, $style.signup]" type="button" :disabled="activeDialog !== null" data-testid="signup" @click="openSignup">
		{{ compact ? i18n.ts.signup : i18n.ts.joinThisServer }}
	</button>
	<button class="_button" :class="[$style.action, $style.signin]" type="button" :disabled="activeDialog !== null" data-testid="signin" @click="openSignin">
		{{ i18n.ts.login }}
	</button>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import type { Ref } from 'vue';
import MkSigninDialog from '@/components/MkSigninDialog.vue';
import MkSignupDialog from '@/components/MkSignupDialog.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
// 仅保留防重复点击的临时 UI 状态，不保存账户或认证流程副本。
const activeDialog: Ref<'signin' | 'signup' | null> = ref(null);

/** 登录按钮进入原有多步认证流程，成功后仍由原账户模块持久化与重载。 */
function openSignin(): void {
	if (activeDialog.value !== null) return;
	activeDialog.value = 'signin';
	const { dispose } = os.popup(MkSigninDialog, { autoSet: true }, {
		/** 释放弹层并恢复本入口按钮，不自行写入登录状态。 */
		closed: (): void => { activeDialog.value = null; dispose(); },
	});
}

/** 注册按钮复用服务器规则、邀请码、邮箱确认等已有流程。 */
function openSignup(): void {
	if (activeDialog.value !== null) return;
	activeDialog.value = 'signup';
	const { dispose } = os.popup(MkSignupDialog, { autoSet: true }, {
		/** 无论关闭或完成，释放既有弹层并恢复临时入口状态。 */
		closed: (): void => { activeDialog.value = null; dispose(); },
	});
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--twitter-entry-action-gap);
	width: 100%;
	max-width: var(--twitter-entry-actions-width);
}
.action {
	display: flex;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	padding: var(--twitter-space-2) var(--twitter-space-4);
	border: 1px solid var(--twitter-entry-border);
	border-radius: var(--twitter-radius-pill);
	font-size: var(--twitter-font-size-content);
	font-weight: 700;
	text-align: center;
	transition: background-color var(--twitter-duration-fast) var(--twitter-ease);

	&:focus-visible {
		outline: 2px solid var(--twitter-accent);
		outline-offset: 2px;
	}
	&:disabled { opacity: 0.6; }
}
.signup {
	min-height: var(--twitter-entry-primary-height);
	background: var(--twitter-entry-fg);
	color: var(--twitter-entry-bg);
	border-color: var(--twitter-entry-fg);

	&:hover { background: color-mix(in srgb, var(--twitter-entry-fg) 85%, var(--twitter-entry-bg)); }
}
.signin {
	min-height: var(--twitter-entry-secondary-height);
	background: var(--twitter-entry-bg);
	color: var(--twitter-entry-fg);

	&:hover { background: var(--twitter-hover); }
}
.compact {
	flex-direction: row;
	gap: var(--twitter-space-2);
	width: auto;

	.action {
		min-height: var(--twitter-entry-secondary-height);
		font-size: var(--twitter-font-size-body);
	}
}
@media (prefers-reduced-motion: reduce) {
	.action { transition: none; }
}
</style>
