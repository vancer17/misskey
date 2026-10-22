/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 帖子卡片的交互导航。
 * 作用：将当前卡片的只读帖子引用转换为既有 Misskey 导航动作。
 * 数据链：帖子引用与指针／键盘事件 → 卡片边界和交互豁免 → notePage → 既有路由或窗口。
 * 本模块不保存帖子事实，不改变基础组件、正文选择或内层控件的交互语义。
 */
import { inject } from 'vue';
import type { ComputedRef } from 'vue';
import type * as Misskey from 'misskey-js';
import type { MkABehavior } from '@/components/global/MkA.vue';
import { DI } from '@/di.js';
import { notePage } from '@/filters/note.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';

/** 标记一次导航所属的实体卡片，隔离引用与回复的嵌套冒泡。 */
const NOTE_CARD_ATTRIBUTE: string = 'data-twitter-note-card';

/** 原生及声明式交互区域保留各自事件；img／span[alt] 覆盖既有表情菜单的实际根节点。 */
const INTERACTIVE_SELECTOR: string = 'a, button, input, textarea, select, option, label, summary, img, span[alt], audio, video, iframe, object, embed, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="textbox"], [role="menuitem"], [tabindex], [data-twitter-note-interactive]';

/** 卡片表现层消费的事件入口，不携带或复制帖子业务状态。 */
export type TwitterNoteNavigationHandlers = {
	/** 处理卡片自身可导航区域的左键点击。 */
	onNoteClick: (event: MouseEvent) => void;
	/** 处理卡片自身可导航区域的鼠标中键。 */
	onNoteAuxClick: (event: MouseEvent) => void;
	/** 为没有既有 Enter 快捷键的卡片提供键盘入口。 */
	onNoteKeydown: (event: KeyboardEvent) => void;
};

/**
 * 判断当前卡片是否包含非折叠文字选区，保护拖选与触屏长按选择。
 * @param card 当前绑定导航入口的卡片元素。
 * @returns 卡片内容是否正在被选中。
 */
function hasCardSelection(card: HTMLElement): boolean {
	const selection: Selection | null = window.getSelection();
	if (selection == null || selection.isCollapsed) return false;
	for (let index: number = 0; index < selection.rangeCount; index++) {
		const range: Range = selection.getRangeAt(index);
		if (!range.collapsed && range.intersectsNode(card)) return true;
	}
	return false;
}

/**
 * 为 Twitter 实体卡片提供导航入口；空引用与样本上下文不导航。
 * @param note 组件当前显示的权威帖子引用；不可导航的样本或缺失引用传入 null。
 * @returns 可绑定到卡片根元素的指针与键盘处理函数。
 */
export function useNoteNavigation(note: ComputedRef<Misskey.entities.Note | null>): TwitterNoteNavigationHandlers {
	const router: ReturnType<typeof useRouter> = useRouter();
	const behavior: MkABehavior = inject<MkABehavior>('linkNavigationBehavior', null);
	const isWindow: boolean = inject<boolean>('inWindow', false);
	const mock: boolean = inject(DI.mock, false);

	/**
	 * 只检查事件目标至当前卡片之间的路径，避免父级交互区吞掉子卡片导航。
	 * @param event 当前卡片收到的原始事件。
	 * @returns 事件是否允许转为当前帖子的导航。
	 */
	function canNavigate(event: MouseEvent | KeyboardEvent): boolean {
		if (event.defaultPrevented || event.altKey || mock || note.value == null) return false;
		const card: EventTarget | null = event.currentTarget;
		if (!(card instanceof HTMLElement) || !card.hasAttribute(NOTE_CARD_ATTRIBUTE)) return false;
		const path: EventTarget[] = event.composedPath();
		const cardIndex: number = path.indexOf(card);
		if (cardIndex < 0) return false;
		for (let index: number = 0; index < cardIndex; index++) {
			const element: EventTarget | undefined = path[index];
			if (!(element instanceof Element)) continue;
			if (element.hasAttribute(NOTE_CARD_ATTRIBUTE) || element.matches(INTERACTIVE_SELECTOR)) return false;
			if (element instanceof HTMLElement && element.isContentEditable) return false;
		}
		return !hasCardSelection(card);
	}

	/**
	 * 按 MkA 的窗口注入约定执行导航；修饰点击与中键显式保留新标签行为。
	 * @param event 已通过边界检查的原始事件。
	 * @param newTab 中键是否明确要求新标签页。
	 */
	function navigate(event: MouseEvent | KeyboardEvent, newTab: boolean): void {
		const targetNote: Misskey.entities.Note | null = note.value;
		if (targetNote == null) return;
		const path: string = notePage(targetNote);
		event.preventDefault();
		if (newTab || event.ctrlKey || event.metaKey) {
			window.open(path, '_blank', 'noopener');
			return;
		}
		if (behavior === 'browser') {
			if (isWindow) {
				window.open(path, '_blank', 'noopener');
			} else {
				window.location.href = path;
			}
			return;
		}
		if (behavior === 'window' || event.shiftKey) {
			os.pageWindow(path);
			return;
		}
		router.pushByPath(path);
	}

	/**
	 * 将未由内层控件处理的左键点击转换为帖子导航。
	 * @param event 浏览器派发的点击事件。
	 */
	function onNoteClick(event: MouseEvent): void {
		if (event.button !== 0 || !canNavigate(event)) return;
		navigate(event, false);
	}

	/**
	 * 将未由内层控件处理的中键点击转换为新标签页导航。
	 * @param event 浏览器派发的辅助点击事件。
	 */
	function onNoteAuxClick(event: MouseEvent): void {
		if (event.button !== 1 || !canNavigate(event)) return;
		navigate(event, true);
	}

	/**
	 * 仅处理卡片自身焦点的 Enter，不接管内层控件或输入法事件。
	 * @param event 卡片收到的键盘事件。
	 */
	function onNoteKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.target !== event.currentTarget || event.isComposing || event.repeat || !canNavigate(event)) return;
		navigate(event, false);
	}

	return {
		/** 普通卡片点击入口。 */
		onNoteClick,
		/** 中键新标签页入口。 */
		onNoteAuxClick,
		/** 无既有 Enter 语义卡片的键盘入口。 */
		onNoteKeydown,
	};
}
