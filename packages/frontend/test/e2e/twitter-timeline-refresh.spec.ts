/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 首页时间线手动刷新真实后端验收。
 * 作用：核查回顶、无新帖反馈、失败保留、实时竞态、归属取消及窗口分页衔接。
 * 语言验收：中文三种反馈经正式语言产物进入页面，日文会话保持独立；截图等待真实提示完成入场。
 * 数据链：隔离测试账户／真实帖子 → 原 API 与原流式事件 → 查询所有者 → 页面 DOM；
 * 传输闸门只延迟或中断真实请求，不伪造业务响应，也不探测或改写产品运行身份。
 */
import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { APIResponse, JSHandle, Locator, Page, PlaywrightTestArgs, Request, Route, TestInfo, WebSocketRoute } from '@playwright/test';
import type { Language } from 'i18n';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 各用例独占服务端签发的会话，不把认证值写入输出。 */
let viewer: AccountWithToken;
let author: AccountWithToken;
let seededNotes: Misskey.entities.Note[];
let errors: string[];

/** 传输控制只保存释放动作及请求计数，不构造业务结果。 */
type TransportGate = Readonly<{ reached: Promise<void>; settled: Promise<void>; release: () => void; requests: () => number }>;
/** 浏览器逐帧观测只读集合，不复制业务模型或影响排序。 */
type ListFrames = Readonly<{ frames: number; emptyFrames: number }>;
/** 单次观测的结束动作在浏览器内清理动画帧。 */
type ListObservation = Readonly<{ finish: () => ListFrames }>;

/** 延迟手动请求；snapshot 模式先取真实响应，再等待测试显式放行。 */
async function holdTimeline(page: Page, snapshot: boolean = false): Promise<TransportGate> {
	const gate: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	const reached: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	const settled: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	let requests: number = 0;
	await page.route('**/api/notes/timeline', /** 只控制原传输时序，分页请求继续原 API。 */ async (route: Route): Promise<void> => {
		const body: Record<string, unknown> = route.request().postDataJSON() as Record<string, unknown>;
		if (body.untilId != null || body.sinceId != null) { await route.continue(); return; }
		requests++;
		const response: APIResponse | null = snapshot ? await route.fetch() : null;
		reached.resolve();
		await gate.promise;
		try {
			if (response == null) await route.continue();
			else await route.fulfill({ response });
		} finally { settled.resolve(); }
	});
	return {
		reached: reached.promise,
		settled: settled.promise,
		release: /** 释放原请求，不改变响应内容。 */ (): void => { gate.resolve(); },
		requests: /** 只统计无游标的最新窗口请求。 */ (): number => requests,
	};
}

/** 真实响应交付之后经过浏览器任务和绘制边界，再核查取消反馈。 */
async function afterResponseRender(page: Page): Promise<void> {
	await page.evaluate(/** 两帧之间允许 Promise 结果处理与 Vue 更新完成，不猜测网络耗时。 */ async (): Promise<void> => {
		await new Promise<void>(/** 首帧允许已交付响应的消费进入任务队列。 */ (resolve: () => void): void => {
			requestAnimationFrame(/** 后续绘制之前完成反馈组件更新。 */ (): void => {
				requestAnimationFrame(/** 返回浏览器实际绘制边界。 */ (): void => { resolve(); });
			});
		});
	});
}

/** 从点击前开始检测列表清空，避免最终恢复掩盖中间整屏闪烁。 */
async function observeList(page: Page): Promise<JSHandle<ListObservation>> {
	return page.getByTestId('twitter-timeline').evaluateHandle(/** 结束后移除动画帧任务，布局仍由应用负责。 */ (root: HTMLElement): ListObservation => {
		let frames: number = 0;
		let emptyFrames: number = 0;
		let frame: number = 0;

		/** 每帧读取节点数量，不修改列表。 */
		function sample(): void {
			frames++;
			if (root.querySelectorAll('[data-testid="twitter-note"]').length === 0) emptyFrames++;
			frame = requestAnimationFrame(sample);
		}

		frame = requestAnimationFrame(sample);
		return { finish: /** 只返回观测计数，不持久化帖子。 */ (): ListFrames => { cancelAnimationFrame(frame); return { frames, emptyFrames }; } };
	});
}

/** 结束保留内容观测，任何清空帧均视为刷新闪烁。 */
async function expectRetained(monitor: JSHandle<ListObservation>): Promise<void> {
	const result: ListFrames = await monitor.evaluate(/** 取回纯观测结果。 */ (value: ListObservation): ListFrames => value.finish());
	await monitor.dispose();
	expect(result.frames).toBeGreaterThan(0);
	expect(result.emptyFrames).toBe(0);
}

/** 仅定位首页时间线，不包含路由缓存或侧栏帖子。 */
function notes(page: Page): Locator { return page.getByTestId('twitter-timeline').getByTestId('twitter-note'); }

/** 直接使用主视口真实滚动位置。 */
async function scrollTop(page: Page): Promise<number> {
	return page.getByTestId('twitter-scroll-viewport').evaluate(/** 不以窗口位置替代主容器。 */ (host: HTMLElement): number => host.scrollTop);
}

/** 在真实容器中读旧帖，触发原列表排队语义。 */
async function scrollMiddle(page: Page): Promise<void> {
	await page.getByTestId('twitter-scroll-viewport').evaluate(/** 原生滚动不改组件状态。 */ (host: HTMLElement): void => { host.scrollTo({ top: 850, behavior: 'instant' }); });
	await expect.poll(/** 等待主容器接纳滚动。 */ async (): Promise<number> => scrollTop(page)).toBeGreaterThan(800);
}

/** 服务端新帖经真实创建接口进入首页及实时流。 */
async function createNote(text: string, account: AccountWithToken = viewer): Promise<Misskey.entities.Note> {
	const result: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, text });
	return result.createdNote;
}

/** 原引导链消费真实会话与语言偏好。 */
async function openTimeline(page: Page, ui: 'twitter' | 'default' = 'twitter', populated: boolean = true, language: Language = 'ja-JP'): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 沿用账户存储和语言偏好契约，不绕过后端认证或翻译装配。 */ ({ account, selectedLanguage }: Readonly<{ account: AccountWithToken; selectedLanguage: Language }>): void => {
		localStorage.setItem('account', JSON.stringify(account));
		localStorage.setItem('lang', selectedLanguage);
	}, { account: viewer, selectedLanguage: language });
	await page.goto(`${BASE_URL}/?ui=${ui}`);
	if (ui === 'twitter') {
		if (populated) await expect(notes(page).first()).toBeVisible();
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
	} else await expect(page.locator('article').filter({ hasText: 'Refresh seed 33' }).first()).toBeVisible();
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	await page.evaluate(/** 字体就绪后才取滚动基线。 */ async (): Promise<void> => { await document.fonts.ready; });
}

/** 实际提示及其祖先均完成入场后才验收，避免“可见”仍处于透明首帧。 */
async function expectOpaqueToast(page: Page, message: string): Promise<Locator> {
	const toast: Locator = page.getByText(message, { exact: true });
	await expect(toast).toBeVisible();
	await expect.poll(/** 观测实际样式链，不关闭产品动效或写入测试状态。 */ async (): Promise<boolean> => toast.evaluate(/** 包含外层 Transition 节点的透明度。 */ (element: HTMLElement): boolean => {
		for (let ancestor: HTMLElement | null = element; ancestor != null; ancestor = ancestor.parentElement) {
			const style: CSSStyleDeclaration = getComputedStyle(ancestor);
			if (Number(style.opacity) < 1 || style.display === 'none' || style.visibility === 'hidden') return false;
		}
		return true;
	})).toBe(true);
	return toast;
}

/** 可选输出真实中文反馈截图；未指定目录时仍核查透明度和窄屏边界。 */
async function captureChineseToast(page: Page, message: string, filename: string, info: TestInfo): Promise<Locator> {
	const toast: Locator = await expectOpaqueToast(page, message);
	const bounds: { x: number; right: number; viewportWidth: number } = await toast.evaluate(/** 提示不能因中文文案宽度溢出真实视口。 */ (element: HTMLElement): { x: number; right: number; viewportWidth: number } => {
		const rectangle: DOMRect = element.getBoundingClientRect();
		return { x: rectangle.x, right: rectangle.right, viewportWidth: innerWidth };
	});
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
	const outputDirectory: string | undefined = process.env.TWITTER_REFRESH_VISUAL_DIR;
	if (outputDirectory != null) {
		await mkdir(outputDirectory, { recursive: true });
		const imagePath: string = join(outputDirectory, filename);
		await page.screenshot({ path: imagePath, animations: 'disabled' });
		await info.attach(filename, { path: imagePath, contentType: 'image/png' });
	}
	return toast;
}

/** 读取当前展示标识集合，仅作为 DOM 断言。 */
async function visibleIds(page: Page): Promise<string[]> {
	return notes(page).evaluateAll(/** 标识不参与产品业务决策。 */ (elements: HTMLElement[]): string[] => elements.map(/** 保留 DOM 顺序。 */ (element: HTMLElement): string => element.dataset.noteId ?? ''));
}

/** 以真实请求识别当前来源查询，不拷贝业务筛选规则。 */
function isLatestHomeRequest(request: Request): boolean {
	if (!request.url().endsWith('/api/notes/timeline')) return false;
	const body: Record<string, unknown> = request.postDataJSON() as Record<string, unknown>;
	return body.untilId == null && body.sinceId == null;
}

test.beforeEach(/** 只重置已启动的隔离 61812 实例。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	const admin: RegisteredUser = await registerUser(BASE_URL, 'refresh_admin', 'refresh-admin-test-password', true);
	viewer = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'refresh_viewer', password: 'refresh-test-password' });
	author = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'refresh_author', password: 'refresh-test-password' });
	await api(BASE_URL, 'following/create', { i: viewer.token, userId: author.id });
	await api(BASE_URL, 'i/registry/set', { i: viewer.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	seededNotes = [];
	for (let index: number = 0; index < 34; index++) seededNotes.push(await createNote(`Refresh seed ${String(index).padStart(2, '0')}\n${'Real backend content keeps the timeline long enough to scroll.\n'.repeat(3)}`));
	errors = [];
	page.on('pageerror', /** 不屏蔽渲染与异步错误。 */ (error: Error): void => { errors.push(error.message); });
	await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(/** 原流事件与刷新均不得留下执行异常。 */ (): void => { expect(errors).toEqual([]); });

test('无新帖时从中部回顶，保留已有分页窗口并显式提示', /** 延迟原请求证明等待期间不清空列表。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openTimeline(page);
	const before: string[] = await visibleIds(page);
	await scrollMiddle(page);
	const monitor: JSHandle<ListObservation> = await observeList(page);
	const gate: TransportGate = await holdTimeline(page);
	try {
		await page.getByTestId('twitter-timeline-refresh').click();
		await gate.reached;
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeDisabled();
		await expect(page.getByTestId('twitter-timeline-refresh')).toHaveAttribute('aria-busy', 'true');
		const glyph: string = await page.getByTestId('twitter-timeline-refresh').locator('i').evaluate(/** 真实 CSS 伪元素须提供字形，不能只有类名。 */ (icon: HTMLElement): string => getComputedStyle(icon, '::before').content);
		expect(['none', 'normal', '""', "''"]).not.toContain(glyph);
		await expect.poll(/** 加载图标须有真实字形宽度，防止生产图标子集遗漏后只剩空按钮。 */ async (): Promise<number> => page.getByTestId('twitter-timeline-refresh').locator('i').evaluate(/** 度量实际绘制盒，不只断言图标类名。 */ (icon: HTMLElement): number => icon.getBoundingClientRect().width)).toBeGreaterThan(10);
		await expect.poll(/** 回顶先于查询完成。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
		expect(await visibleIds(page)).toEqual(before);
		await page.screenshot({ path: info.outputPath('retained-refresh-pending.png'), animations: 'disabled' });
		gate.release();
		await expectOpaqueToast(page, '今回は新しいノートがありません');
		await expect(page.getByText('本次检查暂无新帖子', { exact: true })).toHaveCount(0);
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
		expect(await visibleIds(page)).toEqual(before);
		await expectRetained(monitor);
	} finally { gate.release(); }
});

test('首次成功空集合仍可刷新并明确提示暂无新帖', /** 已初始化为空和未完成首拉由真实请求结果区分。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	for (const note of seededNotes) await api(BASE_URL, 'notes/delete', { i: viewer.token, noteId: note.id });
	await openTimeline(page, 'twitter', false);
	await expect(notes(page)).toHaveCount(0);
	await page.getByTestId('twitter-timeline-refresh').click();
	await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toBeVisible();
	await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
	await expect(notes(page)).toHaveCount(0);
});

test('排队新帖在点击前记入基线，回顶后仍报告已更新', /** 被关注作者避免本用户立即入列特例。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	await scrollMiddle(page);
	const created: Misskey.entities.Note = await createNote('Queued real note before manual refresh', author);
	await expect(page.locator('button').filter({ has: page.locator('i.ti-circle-arrow-up') }).first()).toBeAttached();
	await expect(notes(page).filter({ hasText: created.text ?? '' })).toHaveCount(0);
	await page.getByTestId('twitter-timeline-refresh').click();
	await expect(page.getByText('タイムラインを更新しました', { exact: true })).toBeVisible();
	await expect(notes(page).filter({ hasText: created.text ?? '' })).toBeVisible();
	await expect.poll(/** 新帖实际进入顶部视口。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
});

test('未收到实时通知时仍主动查询真实后端的新帖', /** 只关闭实时传输，新帖由手动 API 获得。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.routeWebSocket('**/streaming*', /** 不伪造任何消息。 */ (socket: WebSocketRoute): void => { socket.close(); });
	await openTimeline(page);
	const created: Misskey.entities.Note = await createNote('Server-only real note discovered by reload', author);
	await expect(notes(page).filter({ hasText: created.text ?? '' })).toHaveCount(0);
	const requested: Promise<Request> = page.waitForRequest(isLatestHomeRequest);
	await page.getByTestId('twitter-timeline-refresh').click();
	await requested;
	await expect(notes(page).filter({ hasText: created.text ?? '' })).toBeVisible();
	await expect(page.getByText('タイムラインを更新しました', { exact: true })).toBeVisible();
});

test('旧查询响应不得覆盖实时新帖或复活已删除帖', /** 真实响应快照之后再制造真实流事件。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	const deleted: Misskey.entities.Note = seededNotes[seededNotes.length - 1];
	const gate: TransportGate = await holdTimeline(page, true);
	try {
		await page.getByTestId('twitter-timeline-refresh').click();
		await gate.reached;
		const created: Misskey.entities.Note = await createNote('Arrived after the real response snapshot', author);
		await expect(notes(page).filter({ hasText: created.text ?? '' })).toBeVisible();
		await api(BASE_URL, 'notes/delete', { i: viewer.token, noteId: deleted.id });
		await expect(page.locator(`[data-testid="twitter-timeline"] [data-note-id="${deleted.id}"]`)).toHaveCount(0);
		gate.release();
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
		await expect(notes(page).filter({ hasText: created.text ?? '' })).toBeVisible();
		await expect(page.locator(`[data-testid="twitter-timeline"] [data-note-id="${deleted.id}"]`)).toHaveCount(0);
		const ids: string[] = await visibleIds(page);
		expect(new Set(ids).size).toBe(ids.length);
		await expect(page.getByText('タイムラインを更新しました', { exact: true })).toBeVisible();
	} finally { gate.release(); }
});

test('网络失败保留内容，重试成功与暂无新帖明确区分', /** 首次中断传输，重试访问真实接口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	const before: string[] = await visibleIds(page);
	let fail: boolean = true;
	await page.route('**/api/notes/timeline', /** 故障不提供替代响应。 */ async (route: Route): Promise<void> => { if (fail) { fail = false; await route.abort(); } else await route.continue(); });
	const monitor: JSHandle<ListObservation> = await observeList(page);
	await page.getByTestId('twitter-timeline-refresh').click();
	await expect(page.getByText('更新できませんでした。もう一度お試しください', { exact: true })).toBeVisible();
	expect(await visibleIds(page)).toEqual(before);
	await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toHaveCount(0);
	await page.getByTestId('twitter-timeline-refresh').click();
	await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toBeVisible();
	expect(await visibleIds(page)).toEqual(before);
	await expectRetained(monitor);
});

test('连续点击只查询一次，响应完成不夺走用户新滚动位置', /** 原生 disabled 阻止重复意图，回顶只发起一次。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	await scrollMiddle(page);
	const gate: TransportGate = await holdTimeline(page);
	try {
		await page.getByTestId('twitter-timeline-refresh').click();
		await gate.reached;
		await expect.poll(/** 等待首次回顶完成。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
		await page.getByTestId('twitter-timeline-refresh').evaluate(/** 浏览器点击遵循原生禁用语义。 */ (button: HTMLButtonElement): void => { button.click(); button.click(); });
		await scrollMiddle(page);
		gate.release();
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
		expect(gate.requests()).toBe(1);
		expect(await scrollTop(page)).toBeGreaterThan(800);
	} finally { gate.release(); }
});

test('旧页查询与手动刷新串行，最终分页窗口仍可用', /** 持有真实旧页请求，同一所有者等待后执行手动意图。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	const gate: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	const reached: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	let pendingOlder: boolean = false;
	let latestWhileOlder: number = 0;
	await page.route('**/api/notes/timeline', /** 只阻塞旧页，其余继续原传输。 */ async (route: Route): Promise<void> => {
		const body: Record<string, unknown> = route.request().postDataJSON() as Record<string, unknown>;
		if (body.untilId != null) { pendingOlder = true; reached.resolve(); await gate.promise; await route.continue(); pendingOlder = false; } else { if (pendingOlder) latestWhileOlder++; await route.continue(); }
	});
	try {
		await page.getByTestId('twitter-scroll-viewport').evaluate(/** 原生滚动触发分页器。 */ (host: HTMLElement): void => { host.scrollTop = host.scrollHeight; });
		await reached.promise;
		await page.getByTestId('twitter-timeline-refresh').click();
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeDisabled();
		expect(latestWhileOlder).toBe(0);
		gate.resolve();
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
		await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toBeVisible();
		expect(latestWhileOlder).toBe(0);
		expect(await notes(page).count()).toBeGreaterThan(15);
	} finally { gate.resolve(); }
});

test('切换来源取消旧刷新，新来源独立反馈', /** Home 迟到响应不能污染 Local 新实例。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	const gate: TransportGate = await holdTimeline(page, true);
	try {
		await page.getByTestId('twitter-timeline-refresh').click();
		await gate.reached;
		await page.getByRole('navigation', { name: 'タイムライン', exact: true }).getByRole('button', { name: 'ローカル', exact: true }).click();
		await expect(page.getByRole('button', { name: 'ローカル', exact: true })).toHaveAttribute('aria-current', 'page');
		await expect(notes(page).first()).toBeVisible();
		gate.release();
		await gate.settled;
		await afterResponseRender(page);
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
		await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toHaveCount(0);
		await page.getByTestId('twitter-timeline-refresh').click();
		await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toBeVisible();
	} finally { gate.release(); }
});

test('修改筛选撤销旧刷新，请求继续沿用真实筛选参数', /** 新查询实例只能接纳新筛选接口返回。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	const gate: TransportGate = await holdTimeline(page, true);
	try {
		await page.getByTestId('twitter-timeline-refresh').click();
		await gate.reached;
		await page.getByRole('button', { name: 'オプション', exact: true }).click();
		const filtered: Promise<Request> = page.waitForRequest(/** 筛选参数由原组件构造，测试仅观察传输。 */ (request: Request): boolean => isLatestHomeRequest(request) && (request.postDataJSON() as Record<string, unknown>).withRenotes === false);
		await page.getByRole('menuitemcheckbox', { name: /リノートを表示$/ }).click();
		gate.release();
		await filtered;
		await gate.settled;
		await afterResponseRender(page);
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
		await expect(notes(page).first()).toBeVisible();
		await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toHaveCount(0);
	} finally { gate.release(); }
});

test('离页撤销刷新，迟到响应不在目标页弹提示', /** 缓存停用同样结束当前操作归属。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page);
	const gate: TransportGate = await holdTimeline(page, true);
	try {
		await page.getByTestId('twitter-timeline-refresh').click();
		await gate.reached;
		await page.getByTestId('twitter-sidebar').locator('a[href="/channels"]').click();
		await expect(page.getByTestId('twitter-communities')).toBeVisible();
		gate.release();
		await gate.settled;
		await afterResponseRender(page);
		await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toHaveCount(0);
		await page.getByTestId('twitter-sidebar').locator('a[href="/"]').last().click();
		await expect(page.getByTestId('twitter-timeline-refresh')).toBeEnabled();
	} finally { gate.release(); }
});

test('超过最新窗口的新帖刷新后继续分页没有中间缺口', /** 实时关闭后核查窗口替换与真实旧页游标。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.routeWebSocket('**/streaming*', /** 内容只能来自刷新及后续分页。 */ (socket: WebSocketRoute): void => { socket.close(); });
	await openTimeline(page);
	const created: Misskey.entities.Note[] = [];
	for (let index: number = 0; index < 38; index++) created.push(await createNote(`Window advance ${index}`, author));
	await page.getByTestId('twitter-timeline-refresh').click();
	await expect(page.getByText('タイムラインを更新しました', { exact: true })).toBeVisible();
	const first: Misskey.entities.Note = created[created.length - 1];
	await expect(page.locator(`[data-testid="twitter-timeline"] [data-note-id="${first.id}"]`)).toBeVisible();
	const expected: string[] = [...created, ...seededNotes].map(/** 仅由真实创建结果派生断言。 */ (note: Misskey.entities.Note): string => note.id).sort().reverse();
	for (let pageIndex: number = 0; pageIndex < 8 && await notes(page).count() < expected.length; pageIndex++) {
		const before: number = await notes(page).count();
		await page.getByTestId('twitter-scroll-viewport').evaluate(/** 原生滚动触发真实请求。 */ (host: HTMLElement): void => { host.scrollTop = host.scrollHeight; });
		await expect.poll(/** 分页必须增加真实实体。 */ async (): Promise<number> => notes(page).count()).toBeGreaterThan(before);
	}
	const actual: string[] = await visibleIds(page);
	expect(actual).toEqual(expected);
	expect(new Set(actual).size).toBe(actual.length);
});

test('默认 UI 继续使用原时间线刷新', /** 未注入工厂路径仍访问原接口。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openTimeline(page, 'default');
	await expect(page.getByTestId('twitter-timeline-refresh')).toHaveCount(0);
	const request: Promise<Request> = page.waitForRequest(isLatestHomeRequest);
	await page.locator('button').filter({ has: page.locator('i.ti-refresh') }).first().click();
	await request;
	await expect(page.locator('article').filter({ hasText: 'Refresh seed 33' }).first()).toBeVisible();
});

/** 在原设备持久化协议中选择非实时模式，供真实页面启动消费。 */
async function configureNonrealtime(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 使用原 IndexedDB 设备偏好协议，避免生产构建不提供的源码模块入口。 */ async (): Promise<void> => {
		await new Promise<void>(/** 在单次事务中保留已有设备设置，只关闭实时模式。 */ (resolve: () => void, reject: (cause: unknown) => void): void => {
			const opening: IDBOpenDBRequest = indexedDB.open('keyval-store', 1);
			/** 初次访问建立 idb-keyval 原对象存储。 */
			opening.onupgradeneeded = (): void => { opening.result.createObjectStore('keyval'); };
			/** 夹具存储失败使测试直接失败。 */
			opening.onerror = (): void => { reject(opening.error); };
			/** 从原偏好读取后做最小补丁，导航前等待提交。 */
			opening.onsuccess = (): void => {
				const database: IDBDatabase = opening.result;
				const transaction: IDBTransaction = database.transaction('keyval', 'readwrite');
				const objects: IDBObjectStore = transaction.objectStore('keyval');
				const reading: IDBRequest<Record<string, unknown> | undefined> = objects.get('pizzax::base');
				/** 只更改既有实时偏好，不增加运行时架构开关。 */
				reading.onsuccess = (): void => { objects.put({ ...reading.result, realtimeMode: false }, 'pizzax::base'); };
				/** 提交之后才允许真实页面启动。 */
				transaction.oncomplete = (): void => { database.close(); resolve(); };
				/** 明确传递事务错误。 */
				transaction.onabort = (): void => { database.close(); reject(transaction.error); };
			};
		});
	});
}

/** 通过实际表单发布，让原全局 notePosted 消费链处理结果。 */
async function publishFromComposer(page: Page, text: string): Promise<void> {
	await page.getByTestId('twitter-sidebar').getByTestId('open-post-form').click();
	await page.getByTestId('post-form-text').fill(text);
	await page.getByTestId('post-form-submit').click();
	await expect(page.getByTestId('post-form-text')).toHaveCount(0);
}

/** 真实发布触发原 notePosted，成功和故障分支都不等待轮询。 */
async function verifyNonrealtimePostedIntent(page: Page, abortFollowup: boolean): Promise<void> {
	await configureNonrealtime(page);
	await openTimeline(page);
	const gate: TransportGate = await holdTimeline(page, true);
	const before: string[] = await visibleIds(page);
	let fail: boolean = abortFollowup;
	await page.route('**/api/notes/timeline', /** 故障分支只中断观察到发布意图后发起的第一次真实新页读取。 */ async (route: Route): Promise<void> => {
		const body: Record<string, unknown> = route.request().postDataJSON() as Record<string, unknown>;
		if (body.sinceId != null && fail) { fail = false; await route.abort(); } else await route.fallback();
	});
	try {
		await page.getByTestId('twitter-timeline-refresh').click();
		await gate.reached;
		await publishFromComposer(page, 'Local publish while a nonrealtime refresh is pending');
		const followup: Promise<Request> = page.waitForRequest(/** 补查必须使用真实新页游标，不重新全量覆盖。 */ (request: Request): boolean => request.url().endsWith('/api/notes/timeline') && (request.postDataJSON() as Record<string, unknown>).sinceId != null, { timeout: 5000 });
		gate.release();
		await followup;
		if (abortFollowup) {
			await expect(page.getByText('更新できませんでした。もう一度お試しください', { exact: true })).toBeVisible();
			expect(await visibleIds(page)).toEqual(before);
			await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toHaveCount(0);
			await page.getByTestId('twitter-timeline-refresh').click();
		}
		await expect(notes(page).filter({ hasText: 'Local publish while a nonrealtime refresh is pending' })).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('タイムラインを更新しました', { exact: true })).toBeVisible();
	} finally { gate.release(); }
}

test('非实时刷新期间本地发布意图在操作结束后立即补查', /** 成功补查应展示真实新帖并反馈更新，不能等到轮询。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await verifyNonrealtimePostedIntent(page, false);
});

test('非实时发布后的必要补查失败须提示失败并允许重试', /** 已观察到发布意图后不能把失败解释为暂无新帖。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await verifyNonrealtimePostedIntent(page, true);
});

test('非实时补查期间再次发布的意图也须在反馈前完成', /** 两次真实发布分属主读取和补查窗口，不以有限轮询掩盖遗漏。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await configureNonrealtime(page);
	await openTimeline(page);
	const primary: TransportGate = await holdTimeline(page, true);
	const newer: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	const reached: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	let newerRequests: number = 0;
	await page.route('**/api/notes/timeline', /** 持有首个真实新页快照，后续新页查询继续原服务端。 */ async (route: Route): Promise<void> => {
		const body: Record<string, unknown> = route.request().postDataJSON() as Record<string, unknown>;
		if (body.sinceId == null) { await route.fallback(); return; }
		newerRequests++;
		if (newerRequests === 1) {
			const response: APIResponse = await route.fetch();
			reached.resolve();
			await newer.promise;
			await route.fulfill({ response });
		} else await route.continue();
	});
	try {
		await page.getByTestId('twitter-timeline-refresh').click();
		await primary.reached;
		await publishFromComposer(page, 'First real publish during primary refresh');
		primary.release();
		await reached.promise;
		await publishFromComposer(page, 'Second real publish during the followup read');
		await expect(page.getByText('タイムラインを更新しました', { exact: true })).toHaveCount(0);
		newer.resolve();
		await expect(notes(page).filter({ hasText: 'First real publish during primary refresh' })).toBeVisible({ timeout: 5000 });
		await expect(notes(page).filter({ hasText: 'Second real publish during the followup read' })).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('タイムラインを更新しました', { exact: true })).toBeVisible();
		expect(newerRequests).toBe(2);
	} finally { primary.release(); newer.resolve(); }
});

/** 中文提示只复用同一刷新业务链，在实际断点与系统主题下核查最终语言产物。 */
const refreshPresentations = [
	/** 桌面浅色覆盖通常阅读状态。 */
	{ name: 'desktop-light', viewport: { width: 1440, height: 1000 }, colorScheme: 'light' },
	/** 桌面深色覆盖深色提示与内容对比。 */
	{ name: 'desktop-dark', viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' },
	/** 窄屏浅色核查最小主列与中文提示边界。 */
	{ name: 'narrow-light', viewport: { width: 320, height: 1000 }, colorScheme: 'light' },
	/** 窄屏深色核查相同尺度下的深色表现。 */
	{ name: 'narrow-dark', viewport: { width: 320, height: 1000 }, colorScheme: 'dark' },
] as const satisfies ReadonlyArray<Readonly<{ name: string; viewport: Readonly<{ width: number; height: number }>; colorScheme: 'light' | 'dark' }>>;

refreshPresentations.forEach(/** 每个表现配置均由真实新帖、无新帖和传输故障完成三态验收。 */ (presentation: typeof refreshPresentations[number]): void => {
	test(`中文刷新三态使用中文且不溢出视口：${presentation.name}`, /** 固定浏览器时钟只稳定相对时间显示，不改变后端业务事实。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		await page.setViewportSize(presentation.viewport);
		await page.emulateMedia({ colorScheme: presentation.colorScheme });
		await page.clock.setFixedTime(new Date(Date.parse(seededNotes[seededNotes.length - 1].createdAt) + 120_000));
		await page.routeWebSocket('**/streaming*', /** 真实新帖必须由刷新接口发现，而非测试注入或实时提前入列。 */ (socket: WebSocketRoute): void => { socket.close(); });
		await openTimeline(page, 'twitter', true, 'zh-CN');
		await expect(page.locator('html')).toHaveAttribute('data-color-scheme', presentation.colorScheme);
		const before: string[] = await visibleIds(page);
		await scrollMiddle(page);
		await page.getByTestId('twitter-timeline-refresh').click();
		const unchanged: Locator = await captureChineseToast(page, '本次检查暂无新帖子', `${presentation.name}-unchanged.png`, info);
		expect(await visibleIds(page)).toEqual(before);
		await expect.poll(/** 中文语言偏好不能改变回顶行为。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
		await expect(unchanged).toHaveCount(0);

		const created: Misskey.entities.Note = await createNote('Chinese refresh real backend update', author);
		await expect(notes(page).filter({ hasText: created.text ?? '' })).toHaveCount(0);
		await page.getByTestId('twitter-timeline-refresh').click();
		await expect(notes(page).filter({ hasText: created.text ?? '' })).toBeVisible();
		const updated: Locator = await captureChineseToast(page, '时间线已更新', `${presentation.name}-updated.png`, info);
		await expect(updated).toHaveCount(0);

		const beforeFailure: string[] = await visibleIds(page);
		await page.route('**/api/notes/timeline', /** 仅中断真实网络传输，不用 Mock 响应证明领域行为。 */ async (route: Route): Promise<void> => { await route.abort(); });
		await page.getByTestId('twitter-timeline-refresh').click();
		await captureChineseToast(page, '刷新失败，请重试', `${presentation.name}-failed.png`, info);
		expect(await visibleIds(page)).toEqual(beforeFailure);
		await expect(page.getByText('今回は新しいノートがありません', { exact: true })).toHaveCount(0);
		await expect(page.getByText('タイムラインを更新しました', { exact: true })).toHaveCount(0);
		await expect(page.getByText('更新できませんでした。もう一度お試しください', { exact: true })).toHaveCount(0);
	});
});
