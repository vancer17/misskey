/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 文件领域：Twitter 五排标签栏的浏览器动效与真实导航回归。
 * 作用：验证共享指示条的几何终态、实际中间帧、快速转向、减少动态效果和缓存恢复。
 * 数据链：隔离实例真实账号／频道 → 原页面与路由 → 只读 DOM 几何；不 Mock 业务响应。
 * 动画采样通过 Web Animations 暂停并定位进度，不使用会快进动画的截图作为过程证据。
 */
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { Locator, Page, PlaywrightTestArgs, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 每个用例使用隔离实例内服务端签发的真实身份。 */
let viewer: AccountWithToken;
/** 动态关注关系始终由真实频道接口建立。 */
let channel: Misskey.entities.Channel;
/** 首帧至用例结束收集异常，避免几何通过掩盖渲染失败。 */
let errors: string[];

/** 内容坐标与宽度的只读投影，仅用于视觉断言。 */
type IndicatorGeometry = Readonly<{ x: number; width: number }>;
/** 一次实际 CSS 转场的起点、中点及终点。 */
type MotionSample = Readonly<{
	before: IndicatorGeometry;
	start: IndicatorGeometry;
	middle: IndicatorGeometry;
	end: IndicatorGeometry;
	animations: number;
	retargetStart: IndicatorGeometry | null;
}>;
/** 真实页面入口与展示根节点，不复制业务标签模型。 */
type PageTarget = Readonly<{ path: string; rootId: string }>;

test.use({ contextOptions: { reducedMotion: 'no-preference' } });

test.beforeEach(/** 仅重建由测试编排启动的隔离实例，不接触开发服务。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	const admin: RegisteredUser = await registerUser(BASE_URL, 'tab_motion_admin', 'tab-motion-admin-password', true);
	await api(BASE_URL, 'admin/update-meta', { i: admin.token, name: 'Tab motion regression', emailRequiredForSignup: false });
	viewer = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'tab_motion_viewer', password: 'tab-motion-password' });
	await api(BASE_URL, 'i/registry/set', { i: viewer.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	channel = await api(BASE_URL, 'channels/create', { i: admin.token, name: 'Motion community', description: 'Real community for tab motion.' });
	await api(BASE_URL, 'notes/create', { i: admin.token, channelId: channel.id, text: 'Real community content.' });
	await api(BASE_URL, 'notes/create', { i: viewer.token, text: 'Real profile content.' });
	errors = [];
	page.on('pageerror', /** 异常报告只保留消息，不输出认证值。 */ (error: Error): void => { errors.push(error.message); });
});

test.afterEach(/** 全部交互必须保持页面无未处理异常。 */ (): void => { expect(errors).toEqual([]); });

/** 会话仍经产品既有认证入口验证，夹具只使用原有持久化格式。 */
async function seedSession(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 保存真实账号，不拼造 API 响应。 */ (account: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(account));
		localStorage.setItem('lang', 'en-US');
	}, viewer);
}

/** 五排标签均经原页面入口挂载，而非独立渲染测试替身。 */
function targets(): readonly PageTarget[] {
	return [
		{ path: '/', rootId: 'twitter-timeline' },
		{ path: '/my/notifications', rootId: 'twitter-notifications' },
		{ path: '/channels', rootId: 'twitter-communities' },
		{ path: `/channels/${channel.id}`, rootId: 'twitter-channel' },
		{ path: `/@${viewer.username}`, rootId: 'twitter-profile' },
	];
}

/** 当前活动页面内唯一指示条，排除 KeepAlive 隐藏树。 */
function indicatorIn(root: Locator): Locator {
	return root.getByTestId('twitter-tab-indicator');
}

/** 只从已渲染 ARIA 属性选择展示锚点，不反向推断业务状态。 */
function selectedTab(root: Locator): Locator {
	return root.locator('[data-twitter-tab-key][aria-current="page"], [data-twitter-tab-key][aria-selected="true"]');
}

/** 验证现有内缩终态及跨页一致的端点形状，内容坐标排除标签栏横滚的影响。 */
async function expectAligned(root: Locator): Promise<void> {
	const indicator: Locator = indicatorIn(root);
	await expect(indicator).toBeVisible();
	const radius: string = await indicator.evaluate(
		/** 上角沿用权威圆角 Token，底角固定为直角，避免各页重新定义端点形状。 */
		(bar: HTMLElement): string => getComputedStyle(bar).getPropertyValue('--twitter-radius-pill').trim(),
	);
	await expect(indicator).toHaveCSS('height', '4px');
	await expect(indicator).toHaveCSS('border-top-left-radius', radius);
	await expect(indicator).toHaveCSS('border-top-right-radius', radius);
	await expect(indicator).toHaveCSS('border-bottom-left-radius', '0px');
	await expect(indicator).toHaveCSS('border-bottom-right-radius', '0px');
	await expect(selectedTab(root)).toHaveCount(1);
	await expect.poll(/** 等待实际几何落位，而非猜测 180ms 后必然完成。 */ async (): Promise<number> => indicatorIn(root).evaluate(
		/** 误差只比较绝对定位元素与所属标签实际盒子。 */
		(bar: HTMLElement): number => {
			const parent: HTMLElement | null = bar.parentElement;
			const tab: HTMLElement | null = parent?.querySelector('[data-twitter-tab-key][aria-current="page"], [data-twitter-tab-key][aria-selected="true"]') ?? null;
			if (parent == null || tab == null) return Number.POSITIVE_INFINITY;
			const inset: number = Number.parseFloat(getComputedStyle(bar).getPropertyValue('--twitter-tab-indicator-inset'));
			const barRect: DOMRect = bar.getBoundingClientRect();
			const tabRect: DOMRect = tab.getBoundingClientRect();
			return Math.max(Math.abs(barRect.left - tabRect.left - inset), Math.abs(barRect.width - Math.max(0, tabRect.width - inset * 2)));
		},
	)).toBeLessThanOrEqual(1);
}

/** 在浏览器内捕获并暂停真实 CSS 转场，快速重选可从中点直接转向原标签。 */
async function sampleMotion(root: Locator, targetKey: string, retargetKey: string | null = null): Promise<MotionSample> {
	return indicatorIn(root).evaluate(/** 所有等待均依赖浏览器帧，不修改产品选中状态。 */ async (bar: HTMLElement, input: { targetKey: string; retargetKey: string | null }): Promise<MotionSample> => {
		const parent: HTMLElement | null = bar.parentElement;
		if (parent == null) throw new Error('Missing indicator container');

		/** 读取 CSS 变换的内容坐标，滚动不应伪造横移动画。 */
		function geometry(): IndicatorGeometry {
			const style: CSSStyleDeclaration = getComputedStyle(bar);
			return { x: new DOMMatrixReadOnly(style.transform).m41, width: bar.getBoundingClientRect().width };
		}

		/** 真实点击原节点；事件仍由页面及既有路由消费。 */
		function clickKey(key: string): void {
			const tabs: NodeListOf<HTMLElement> = parent!.querySelectorAll('[data-twitter-tab-key]');
			for (let index: number = 0; index < tabs.length; index++) {
				const tab: HTMLElement = tabs[index];
				if (tab.dataset.twitterTabKey === key) { tab.click(); return; }
			}
			throw new Error(`Missing rendered tab ${key}`);
		}

		/** 等待 Vue 提交与组件测量安排的绘制边界。 */
		async function nextFrame(): Promise<void> {
			await new Promise<void>(/** 动画帧本身不替换响应或业务事实。 */ (resolve: () => void): void => {
				requestAnimationFrame(/** 在当前帧交回采样控制。 */ (): void => { resolve(); });
			});
		}

		/** 样式读取触发真实过渡建立，随后立即暂停以稳定采样。 */
		async function pauseMotion(previous: Animation[] = []): Promise<Animation[]> {
			for (let frame: number = 0; frame < 30; frame++) {
				void getComputedStyle(bar).transform;
				const animations: Animation[] = bar.getAnimations();
				if (animations.length > 0 && animations.some(/** 新目标必须建立独立过渡，不能误采上一轮暂停动画。 */ (animation: Animation): boolean => !previous.includes(animation))) {
					for (let index: number = 0; index < animations.length; index++) animations[index].pause();
					return animations;
				}
				await nextFrame();
			}
			throw new Error('Tab selection did not create a CSS transition');
		}

		/** 按原动画时长定位进度，测试不覆盖产品时长或缓动。 */
		function seek(animations: Animation[], progress: number): void {
			for (let index: number = 0; index < animations.length; index++) {
				const animation: Animation = animations[index];
				animation.currentTime = Number(animation.effect?.getComputedTiming().duration ?? 0) * progress;
			}
		}

		const before: IndicatorGeometry = geometry();
		clickKey(input.targetKey);
		let animations: Animation[] = await pauseMotion();
		const animationCount: number = animations.length;
		seek(animations, 0);
		const start: IndicatorGeometry = geometry();
		seek(animations, 0.5);
		const middle: IndicatorGeometry = geometry();
		let retargetStart: IndicatorGeometry | null = null;
		if (input.retargetKey != null) {
			clickKey(input.retargetKey);
			animations = await pauseMotion(animations);
			seek(animations, 0);
			retargetStart = geometry();
		}
		for (let index: number = 0; index < animations.length; index++) animations[index].finish();
		await nextFrame();
		return { before, start, middle, end: geometry(), animations: animationCount, retargetStart };
	}, { targetKey, retargetKey });
}

/** 取回 DOM 原始标识，未定义的展示锚点直接报告失败。 */
async function keyOf(tab: Locator): Promise<string> {
	const key: string | null = await tab.getAttribute('data-twitter-tab-key');
	if (key == null) throw new Error('Rendered tab lacks its geometry anchor');
	return key;
}

for (let matrixIndex: number = 0; matrixIndex < 2; matrixIndex++) {
	const width: number = matrixIndex === 0 ? 1440 : 390;
	test(`${width}px 五排标签具有连续中间帧并保持既有终态`, /** 真实页面依次验证，宽度和配色与截图证据相互独立。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
		await page.setViewportSize({ width, height: 1000 });
		await page.emulateMedia({ colorScheme: matrixIndex === 0 ? 'light' : 'dark' });
		await api(BASE_URL, 'channels/follow', { i: viewer.token, channelId: channel.id });
		await seedSession(page);
		const pages: readonly PageTarget[] = targets();
		for (let index: number = 0; index < pages.length; index++) {
			const target: PageTarget = pages[index];
			await page.goto(`${BASE_URL}${target.path}?ui=twitter`);
			const root: Locator = page.getByTestId(target.rootId);
			await expectAligned(root);
			const sample: MotionSample = await sampleMotion(root, await keyOf(root.locator('[data-twitter-tab-key]').last()));
			expect(sample.animations).toBeGreaterThan(0);
			expect(Math.abs(sample.start.x - sample.before.x)).toBeLessThanOrEqual(1);
			expect(sample.middle.x).toBeGreaterThan(sample.start.x + 1);
			expect(sample.middle.x).toBeLessThan(sample.end.x - 1);
			await expectAligned(root);
			const motionPath: string = info.outputPath(`${target.rootId}-motion.json`);
			await writeFile(motionPath, JSON.stringify(sample, null, 2));
			await info.attach(`${target.rootId}-motion`, { path: motionPath, contentType: 'application/json' });
		}
	});
}

test('窄时间线快速转向从当前帧继续且取消过时横滚', /** 已存在的窄标签栏触发真实溢出，不通过改 DOM 拼造业务标签。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.setViewportSize({ width: 320, height: 1000 });
	await seedSession(page);
	await page.goto(`${BASE_URL}/?ui=twitter`);
	const root: Locator = page.getByTestId('twitter-timeline');
	await expectAligned(root);
	const tabs: Locator = root.locator('[data-twitter-tab-key]');
	const first: string = await keyOf(tabs.first());
	const last: string = await keyOf(tabs.last());
	const sample: MotionSample = await sampleMotion(root, last, first);
	expect(sample.retargetStart).not.toBeNull();
	expect(Math.abs(sample.retargetStart!.x - sample.middle.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(sample.end.x - sample.before.x)).toBeLessThanOrEqual(1);
	await expectAligned(root);
	await expect(selectedTab(root)).toHaveAttribute('data-twitter-tab-key', first);
	await expect.poll(/** 旧目标的平滑横滚不能继续把当前标签带出左边界。 */ async (): Promise<number> => indicatorIn(root).evaluate(
		/** 只读局部滚动量，不操作 Shell 纵向位置。 */ (bar: HTMLElement): number => bar.parentElement?.scrollLeft ?? -1,
	)).toBeLessThanOrEqual(1);
});

test('减少动态效果时五排标签直接定位且没有过渡', /** 媒体偏好在页面启动前设定，覆盖已有全局偏好读取时机。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await seedSession(page);
	const pages: readonly PageTarget[] = targets();
	for (let index: number = 0; index < pages.length; index++) {
		const target: PageTarget = pages[index];
		await page.goto(`${BASE_URL}${target.path}?ui=twitter`);
		const root: Locator = page.getByTestId(target.rootId);
		await expectAligned(root);
		await root.locator('[data-twitter-tab-key]').last().click();
		await expectAligned(root);
		expect(await indicatorIn(root).evaluate(/** 禁用动态效果时无排队动画。 */ (bar: HTMLElement): number => bar.getAnimations().length)).toBe(0);
	}
});

test('频道搜索重挂载及真实关注改变标签集合都静态校准', /** 结构变动依据原查询结果，不能从旧位置播放虚构导航。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await seedSession(page);
	await page.goto(`${BASE_URL}/channels?ui=twitter`);
	const communities: Locator = page.getByTestId('twitter-communities');
	await expectAligned(communities);
	await communities.locator('[data-twitter-tab-key="explore"]').click();
	await expectAligned(communities);
	await communities.getByTestId('twitter-community-search').click();
	const input: Locator = communities.getByRole('searchbox');
	await input.fill(channel.name);
	await input.press('Enter');
	await expect(indicatorIn(communities)).toHaveCount(0);
	await expect(communities.locator(`a[href="/channels/${channel.id}"]`)).toBeVisible();
	await communities.getByRole('button', { name: 'Close', exact: true }).click();
	await expectAligned(communities);
	expect(await indicatorIn(communities).evaluate(/** 新指示条初次定位没有导航起点。 */ (bar: HTMLElement): number => bar.getAnimations().length)).toBe(0);
	await page.goto(`${BASE_URL}/channels/${channel.id}?ui=twitter`);
	const detail: Locator = page.getByTestId('twitter-channel');
	await expectAligned(detail);
	await expect(detail.locator('[data-twitter-tab-key]')).toHaveCount(3);
	await detail.getByRole('button', { name: 'Follow', exact: true }).click();
	await expect(detail.locator('[data-twitter-tab-key]')).toHaveCount(4);
	await expectAligned(detail);
	await expect(selectedTab(detail)).toHaveAttribute('data-twitter-tab-key', 'home');
	expect(await indicatorIn(detail).evaluate(/** 增加标签只是结构校准，不从旧排位置飞入。 */ (bar: HTMLElement): number => bar.getAnimations().length)).toBe(0);
});

test('资料路由复用与缓存回访保留链接语义及指示条定位', /** 导航仍用原链接和历史，不重建面板作为动效手段。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await seedSession(page);
	await page.goto(`${BASE_URL}/@${viewer.username}?ui=twitter`);
	const profile: Locator = page.getByTestId('twitter-profile');
	await expectAligned(profile);
	const replies: Locator = profile.locator('[data-twitter-tab-key="replies"]');
	await expect(replies).toHaveAttribute('href', `/@${viewer.username}/replies`);
	await replies.click();
	await expect(page).toHaveURL(`${BASE_URL}/@${viewer.username}/replies`);
	await expectAligned(profile);
	await expect(selectedTab(profile)).toHaveAttribute('data-twitter-tab-key', 'replies');
	await page.goBack();
	await expectAligned(profile);
	await expect(selectedTab(profile)).toHaveAttribute('data-twitter-tab-key', 'notes');
	await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
	await expect(page.getByTestId('profile-name')).toBeVisible();
	await page.goBack();
	await expectAligned(profile);
	expect(await indicatorIn(profile).evaluate(/** 缓存恢复只建立当前位置，不重播上一轮路由动画。 */ (bar: HTMLElement): number => bar.getAnimations().length)).toBe(0);
});
