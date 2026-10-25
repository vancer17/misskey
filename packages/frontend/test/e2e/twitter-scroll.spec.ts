/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Twitter 主滚动真实后端回归：窗口边缘几何、原生滚动、路由位置恢复和模态／附件交互。
 * 只使用隔离测试实例；网络延迟保留真实响应，布局数据来自实际 DOM，不探测运维状态。
 */
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { APIResponse, JSHandle, Locator, Page, PlaywrightTestArgs, Route, TestInfo } from '@playwright/test';
import type * as Misskey from 'misskey-js';
import type { AccountWithToken } from '../../src/accounts/index.js';
import type { PreferencesProfile } from '../../src/preferences/manager.js';
import { api, registerUser, resetState } from './shared.js';
import type { RegisteredUser } from './shared.js';
import { BASE_URL } from './utils.js';

/** 保留浏览器原生滚动条，以占位式滚动条核查主列宽度。 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar,FluentOverlayScrollbar'] } });

/** 真实服务端签发的测试账户，不保存到产物或日志。 */
let account: AccountWithToken;
/** 记录浏览器执行异常；不屏蔽路由/渲染异常。 */
let errors: string[];

test.beforeEach(/** 建立独立资料和足够长的真实帖子流。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await resetState(BASE_URL);
	const admin: RegisteredUser = await registerUser(BASE_URL, 'scroll_admin', 'scroll-admin-test-password', true);
	account = await api(BASE_URL, 'admin/accounts/create', { i: admin.token, username: 'scroll_user', password: 'scroll-test-password' });
	await api(BASE_URL, 'i/registry/set', { i: account.token, scope: ['client', 'base'], key: 'accountSetupWizard', value: -1 });
	for (let index: number = 0; index < 28; index++) {
		await api(BASE_URL, 'notes/create', {
			i: account.token,
			text: `Scroll note ${index}\n${'Stable real backend content for scroll geometry.\n'.repeat(3)}`,
		});
	}
	errors = [];
	page.on('pageerror', /** 仅记录错误消息。 */ (error: Error): void => { errors.push(error.message); });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`${BASE_URL}/robots.txt`);
	await page.evaluate(/** 使用原账户持久化契约，认证仍由真实启动链验证。 */ (user: AccountWithToken): void => {
		localStorage.setItem('account', JSON.stringify(user));
		localStorage.setItem('lang', 'en-US');
	}, account);
});

test.afterEach(/** 从首帧开始记录的执行错误必须为空。 */ (): void => { expect(errors).toEqual([]); });

/** 首次导航之后仅通过原链接和历史操作回访。 */
async function openProfile(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/@${account.username}?ui=twitter`);
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await expect(page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').first()).toBeVisible();
	// 滚动基线必须取在启动主题切换完成后，避免点击重试的自动滚动改变已保存位置。
	await expect(page.locator('html')).not.toHaveClass(/_themeChanging_/);
	await page.evaluate(/** 等待实际字体就绪后再测量几何，不用固定延迟猜测排版完成。 */ async (): Promise<void> => {
		await document.fonts.ready;
	});
}

/** 当前主滚动宿主的唯一定位点。 */
function viewport(page: Page): Locator {
	return page.getByTestId('twitter-scroll-viewport');
}

/** 读取原生元素位置，不使用 window.scrollY 作为主位置的替代。 */
async function scrollTop(page: Page): Promise<number> {
	return viewport(page).evaluate(/** 浏览器真实滚动位置。 */ (element: HTMLElement): number => element.scrollTop);
}

/** 在真实页面滚动，不改写业务组件状态。 */
async function scrollTo(page: Page, top: number): Promise<void> {
	await viewport(page).evaluate(/** 原生滚动 API。 */ (element: HTMLElement, position: number): void => { element.scrollTo({ top: position, behavior: 'instant' }); }, top);
	await expect.poll(/** 等待浏览器位置生效。 */ async (): Promise<number> => Math.abs(await scrollTop(page) - top)).toBeLessThan(2);
}

/** 浏览器观测结果仅描述滚动和帖子锚点的几何偏差，不复制领域状态。 */
type ScrollDrift = Readonly<{
	maxTopDelta: number;
	maxAnchorDelta: number;
	anchorConnected: boolean;
}>;

/** 单次交互的浏览器采样器，结束后移除监听及动画帧任务。 */
type ScrollObservation = Readonly<{
	finish: () => Promise<ScrollDrift>;
	dispose: () => void;
}>;

/** 从交互基线开始逐帧采样，结束后继续观察 60 帧，捕获延迟启动和平滑回顶的中间帧。 */
async function observeScroll(card: Locator): Promise<JSHandle<ScrollObservation>> {
	return card.evaluateHandle(/** 只观测实际主视口与当前可见帖子，不向产品状态注入测试字段。 */ (anchor: HTMLElement): ScrollObservation => {
		const host: HTMLElement | null = anchor.closest('[data-testid="twitter-scroll-viewport"]');
		if (host == null) throw new Error('Expected a main scroll viewport');
		const savedTop: number = host.scrollTop;
		const savedAnchor: number = anchor.getBoundingClientRect().top - host.getBoundingClientRect().top;
		let maxTopDelta: number = 0;
		let maxAnchorDelta: number = 0;
		let frame: number = 0;
		/** 同时记录最大位置偏差，防止最终回到原处掩盖中途跳动。 */
		const sample: () => void = (): void => {
			maxTopDelta = Math.max(maxTopDelta, Math.abs(host.scrollTop - savedTop));
			maxAnchorDelta = Math.max(maxAnchorDelta, Math.abs(anchor.getBoundingClientRect().top - host.getBoundingClientRect().top - savedAnchor));
		};
		/** 逐帧读取与 scroll 事件互补，覆盖浏览器布局与原生平滑滚动。 */
		const tick: () => void = (): void => {
			sample();
			frame = requestAnimationFrame(tick);
		};
		/** 清理单次浏览器观测，不保留跨交互的可变测试状态。 */
		const dispose: () => void = (): void => {
			host.removeEventListener('scroll', sample);
			cancelAnimationFrame(frame);
		};
		host.addEventListener('scroll', sample, { passive: true });
		frame = requestAnimationFrame(tick);
		return {
			dispose,
			/** 弹层退出后继续采样固定帧数，避免立即成功的轮询漏掉稍后启动的滚动。 */
			finish: async (): Promise<ScrollDrift> => {
				for (let index: number = 0; index < 60; index++) {
					await new Promise<void>(/** 将下一帧作为稳定观察边界。 */ (resolve: () => void): void => {
						requestAnimationFrame(/** 保留整帧供浏览器布局及滚动提交。 */ (): void => { resolve(); });
					});
				}
				sample();
				dispose();
				return { maxTopDelta, maxAnchorDelta, anchorConnected: anchor.isConnected };
			},
		};
	});
}

/** 结束并核对交互全过程的位置与锚点，允许浏览器不足两个像素的取整误差。 */
async function expectStableScroll(observation: JSHandle<ScrollObservation>): Promise<void> {
	const drift: ScrollDrift = await observation.evaluate(/** 等待弹层之后的完整稳定窗口。 */ async (monitor: ScrollObservation): Promise<ScrollDrift> => monitor.finish());
	expect(drift.anchorConnected).toBe(true);
	expect(drift.maxTopDelta).toBeLessThanOrEqual(2);
	expect(drift.maxAnchorDelta).toBeLessThanOrEqual(2);
}

/** 即使用例在关闭前失败，也移除浏览器采样资源。 */
async function disposeObservation(observation: JSHandle<ScrollObservation>): Promise<void> {
	await observation.evaluate(/** 清理当前观测，不影响产品滚动行为。 */ (monitor: ScrollObservation): void => { monitor.dispose(); });
	await observation.dispose();
}

/** 从仓库固定媒体上传至真实 Drive，返回服务端文件实体。 */
async function uploadAttachment(page: Page, path: string, name: string, mimeType: 'image/png' | 'video/mp4'): Promise<Misskey.entities.DriveFile> {
	const buffer: Buffer = await readFile(new URL(path, import.meta.url));
	const response: APIResponse = await page.request.post(`${BASE_URL}/api/drive/files/create`, {
		multipart: { i: account.token, file: { name, mimeType, buffer } },
	});
	expect(response.ok()).toBe(true);
	return await response.json();
}

/** 建立真实双附件帖子，再发布较新的内容使目标位于列表中段。 */
async function createAttachmentNote(page: Page, channelId?: string): Promise<Misskey.entities.Note> {
	const image: Misskey.entities.DriveFile = await uploadAttachment(page, './fixtures/avatar-decoration-frame.png', 'scroll-image.png', 'image/png');
	const video: Misskey.entities.DriveFile = await uploadAttachment(page, './fixtures/video-upload/video-silent.mp4', 'scroll-video.mp4', 'video/mp4');
	const created: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', {
		i: account.token, text: 'Real image and video attachment scroll regression', fileIds: [image.id, video.id], ...(channelId == null ? {} : { channelId }),
	});
	for (let index: number = 0; index < 10; index++) {
		await api(BASE_URL, 'notes/create', {
			i: account.token, text: `Newer attachment context ${index}\n${'Stable real backend content for scroll geometry.\n'.repeat(3)}`, ...(channelId == null ? {} : { channelId }),
		});
	}
	return created.createdNote;
}

/** 本次回归覆盖的原生附件关闭入口，仅属于测试交互策略。 */
type AttachmentCloseMethod = 'button' | 'blank' | 'escape' | 'history';

/** 从实际入口打开附件，以打开后的实际位置为基线核对整个关闭过程。 */
async function expectAttachmentCloseStable(page: Page, card: Locator, file: Misskey.entities.DriveFile, method: AttachmentCloseMethod): Promise<void> {
	await page.evaluate(/** 以实际字体加载完成作为几何测量前提，不用固定延迟猜测排版稳定。 */ async (): Promise<void> => { await document.fonts.ready; });
	const source: Locator = file.type.startsWith('image/') ? card.locator(`img[title="${file.name}"]`).first() : card.locator('i.ti-player-play').first();
	await source.scrollIntoViewIfNeeded();
	await expect(source).toBeVisible();
	// 实际输入前先完成可点击性检查，保留基础组件自身的焦点定位行为。
	await source.click({ trial: true });
	const sourceBox: Awaited<ReturnType<Locator['boundingBox']>> = await source.boundingBox();
	if (sourceBox == null) throw new Error('Expected a visible attachment entrance');
	expect(await scrollTop(page)).toBeGreaterThan(400);
	const originalUrl: string = page.url();
	await page.mouse.click(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
	await expect(page).toHaveURL(`${originalUrl}#pswp`);
	const lightbox: Locator = page.locator('div:has(> ._modalBg)').filter({ has: page.getByText(file.name, { exact: true }) });
	await expect(lightbox).toBeVisible();
	await expect(viewport(page)).toHaveAttribute('inert', '');
	await lightbox.evaluate(/** 等待实际打开过渡结束，关闭采样不包含仍在完成的打开动画。 */ async (element: HTMLElement): Promise<void> => {
		const animations: Animation[] = element.getAnimations({ subtree: true });
		for (const animation of animations) {
			if (animation.effect?.getComputedTiming().iterations === Infinity) continue;
			try {
				await animation.finished;
			} catch {
				// 被取消的打开过渡同样已结束，不阻止后续真实关闭操作。
			}
		}
	});
	// 打开过程中的原生焦点定位完成后再记录关闭基线，关闭导致的任何回顶仍须被捕获。
	expect(await scrollTop(page)).toBeGreaterThan(400);
	const observation: JSHandle<ScrollObservation> = await observeScroll(card);
	try {
		if (method === 'button') {
			const title: Locator = lightbox.locator('div:has(> button > i.ti-x)').filter({ has: page.getByText(file.name, { exact: true }) });
			await title.getByRole('button').filter({ has: page.locator('i.ti-x') }).click();
		} else if (method === 'blank') {
			const size: ReturnType<Page['viewportSize']> = page.viewportSize();
			if (size == null) throw new Error('Expected a fixed browser viewport');
			// 首末附件分别使用没有上一张／下一张导航按钮的一侧空白。
			const hasPrevious: boolean = await lightbox.getByRole('button').filter({ has: page.locator('i.ti-arrow-left') }).count() > 0;
			await page.mouse.click(hasPrevious ? size.width - 20 : 20, Math.round(size.height / 2));
		} else if (method === 'escape') {
			await page.keyboard.press('Escape');
		} else {
			await page.goBack();
		}
		await expect(page).toHaveURL(originalUrl);
		await expect(lightbox).toHaveCount(0);
		await expect(viewport(page)).not.toHaveAttribute('inert', '');
		await expectStableScroll(observation);
	} finally {
		await disposeObservation(observation);
	}
}

/** 校验所有标准页面根没有自己的纵向滚动容器。 */
async function expectSingleMainScroll(page: Page): Promise<void> {
	const containers: string[] = await page.locator('[data-twitter-route-outlet]').evaluate(
		/** 局部控件不在这组标准页面壳选择器中。 */ (outlet: HTMLElement): string[] => [outlet, ...outlet.querySelectorAll<HTMLElement>('._pageScrollable')]
			.filter(/** 只检查实际可见的主页面壳。 */ (node: HTMLElement): boolean => node.getBoundingClientRect().height > 0)
			.map(/** 返回布局属性而不是业务内容。 */ (node: HTMLElement): string => getComputedStyle(node).overflowY),
	);
	expect(containers.length).toBeGreaterThan(0);
	expect(containers.every(/** 标准页面根不能抢占主滚动。 */ (overflow: string): boolean => overflow === 'visible')).toBe(true);
}

/** 本用例的 DOM 几何记录，不构造用户或帖子模型。 */
type ScrollGeometry = Readonly<{
	viewportRight: number;
	windowWidth: number;
	horizontalOverflow: number;
	innerGutter: number;
	mainRight: number;
	profileRight: number;
	windowY: number;
	nativeGutter: number;
}>;

test('全宽原生视口消除中间栏滚动条占位并保持吸顶', /** 几何、滚轮与键盘一起证明滚动归属。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openProfile(page);
	await expectSingleMainScroll(page);
	const measurements: ScrollGeometry = await viewport(page).evaluate(/** 测量右缘、横向溢出和文档位置。 */ (host: HTMLElement): ScrollGeometry => {
		const main: HTMLElement = host.querySelector('main')!;
		const profile: HTMLElement = host.querySelector('[data-testid="twitter-profile"]')!;
		return { viewportRight: host.getBoundingClientRect().right, windowWidth: innerWidth, horizontalOverflow: host.scrollWidth - host.clientWidth,
			innerGutter: profile.offsetWidth - profile.clientWidth, mainRight: main.getBoundingClientRect().right, profileRight: profile.getBoundingClientRect().right,
			windowY: scrollY, nativeGutter: host.offsetWidth - host.clientWidth };
	});
	expect(Math.abs(measurements.viewportRight - measurements.windowWidth)).toBeLessThan(1);
	expect(measurements.horizontalOverflow).toBeLessThanOrEqual(1);
	expect(measurements.innerGutter).toBe(0);
	expect(measurements.nativeGutter).toBeGreaterThan(0);
	expect(Math.abs(measurements.mainRight - measurements.profileRight)).toBeLessThanOrEqual(1);
	expect(measurements.windowY).toBe(0);
	await writeFile(info.outputPath('native-scroll-geometry.json'), JSON.stringify(measurements, null, 2));
	await page.screenshot({ path: info.outputPath('profile-top.png'), animations: 'disabled' });
	await page.mouse.move(700, 600);
	await page.mouse.wheel(0, 650);
	await expect.poll(/** 原生滚轮只改变主视口。 */ async (): Promise<number> => scrollTop(page)).toBeGreaterThan(400);
	expect(await page.getByTestId('twitter-profile').evaluate(/** 页面根不再自己滚动。 */ (node: HTMLElement): number => node.scrollTop)).toBe(0);
	const headerTop: number = await page.getByTestId('twitter-profile').locator(':scope > header').evaluate(/** 吸顶头相对主视口。 */ (header: HTMLElement): number => header.getBoundingClientRect().top);
	expect(headerTop).toBeLessThanOrEqual(2);
	expect(headerTop).toBeGreaterThanOrEqual(0);
	await page.screenshot({ path: info.outputPath('profile-scrolled.png'), animations: 'disabled' });
	await viewport(page).focus();
	const before: number = await scrollTop(page);
	await page.keyboard.press('PageDown');
	await expect.poll(/** 主视口支持原生键盘滚动。 */ async (): Promise<number> => scrollTop(page)).toBeGreaterThan(before + 100);
});

test('资料与帖子详情返回后恢复原锚点而不是继承下一页位置', /** 真实回访包含列表重取和异步 DOM 替换。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	const card: Locator = page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').nth(7);
	await card.scrollIntoViewIfNeeded();
	const id: string | null = await card.getAttribute('data-note-id');
	if (id == null) throw new Error('Expected a real note identifier');
	const saved: number = await scrollTop(page);
	const offset: number = await card.evaluate(/** 保存可见节点的位置。 */ (node: HTMLElement): number => node.getBoundingClientRect().top);
	await card.locator(`a[href="/notes/${id}"]`).first().click();
	await expect(page).toHaveURL(new RegExp(`/notes/${id}`));
	await expectSingleMainScroll(page);
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await expect.poll(/** 真实 users/notes 回填后恢复原位置。 */ async (): Promise<number> => Math.abs(await scrollTop(page) - saved)).toBeLessThan(5);
	await expect.poll(/** 内容锚点也应一致。 */ async (): Promise<number> => Math.abs(await page.locator(`[data-note-id="${id}"]`).first().evaluate((node: HTMLElement): number => node.getBoundingClientRect().top) - offset)).toBeLessThan(5);
});

test('编辑页保留独立滚动位置和未保存输入', /** 多个缓存页共享一个宿主仍分别保存位置。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openProfile(page);
	await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
	await page.getByTestId('profile-name').locator('input').fill('scroll draft');
	await scrollTo(page, 400);
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
	await expect.poll(/** 返回的是编辑页自己的位置。 */ async (): Promise<number> => Math.abs(await scrollTop(page) - 400)).toBeLessThan(5);
	await expect(page.getByTestId('profile-name').locator('input')).toHaveValue('scroll draft');
	await expectSingleMainScroll(page);
	await page.screenshot({ path: info.outputPath('editor-restored.png'), animations: 'disabled' });
});

/** 附件回访所覆盖的页面入口，复用各页面真实数据查询。 */
type AttachmentPage = 'profile' | 'timeline' | 'channel';

/** 仅枚举测试范围，不构造另一份业务路由配置。 */
const attachmentPages: readonly AttachmentPage[] = ['profile', 'timeline', 'channel'];

for (const location of attachmentPages) {
	test(`${location} 图片与视频附件通过关闭按钮或空白退出后保持帖子位置`, /** 三类页面分别消费真实附件帖子，共同核查主宿主的同地址回访。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
		let channelId: string | undefined;
		if (location === 'channel') {
			const channel: Misskey.entities.Channel = await api(BASE_URL, 'channels/create', { i: account.token, name: 'Attachment scroll channel', description: '' });
			await api(BASE_URL, 'channels/follow', { i: account.token, channelId: channel.id });
			channelId = channel.id;
		}
		const note: Misskey.entities.Note = await createAttachmentNote(page, channelId);
		const path: string = location === 'profile' ? `/@${account.username}` : location === 'timeline' ? '/' : `/channels/${channelId}`;
		await page.goto(`${BASE_URL}${path}?ui=twitter`);
		const card: Locator = page.locator('[data-twitter-route-outlet] article:visible').filter({ has: page.locator(`a[href="/notes/${note.id}"]`) }).first();
		await expect(card).toBeVisible();
		const files: Misskey.entities.DriveFile[] = note.files ?? [];
		expect(files).toHaveLength(2);
		for (const file of files) {
			await expectAttachmentCloseStable(page, card, file, 'button');
			await expectAttachmentCloseStable(page, card, file, 'blank');
		}
		if (location === 'profile') {
			await expectAttachmentCloseStable(page, card, files[0], 'escape');
			await expectAttachmentCloseStable(page, card, files[1], 'history');
		}
	});
}

test('移动视口重复打开附件后仍保持原帖子且不多退历史', /** 使用真实图片和现有关闭入口验证窄屏共享回访链。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	const note: Misskey.entities.Note = await createAttachmentNote(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await openProfile(page);
	const card: Locator = page.getByTestId('twitter-user-timeline-notes').locator(`[data-testid="twitter-note"][data-note-id="${note.id}"]:visible`).first();
	const image: Misskey.entities.DriveFile | undefined = note.files?.find(/** 直接选择真实服务端实体，不复制附件协议。 */ (file: Misskey.entities.DriveFile): boolean => file.type.startsWith('image/'));
	if (image == null) throw new Error('Expected an uploaded image');
	await expectAttachmentCloseStable(page, card, image, 'button');
	await expectAttachmentCloseStable(page, card, image, 'button');
});

test('模态框打开时背景不可滚动并在关闭后恢复交互', /** 不改动共享弹层实现，背景宿主仍可被滚动工具发现。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	await scrollTo(page, 600);
	const saved: number = await scrollTop(page);
	const observation: JSHandle<ScrollObservation> = await observeScroll(page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').first());
	try {
		await page.getByTestId('open-post-form').click();
		await expect(page.getByTestId('post-form-text')).toBeVisible();
		await expect(viewport(page)).toHaveAttribute('inert', '');
		await page.mouse.move(40, 400);
		await page.mouse.wheel(0, 600);
		await page.keyboard.press('PageDown');
		expect(await scrollTop(page)).toBe(saved);
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('post-form-text')).toHaveCount(0);
		await expect(viewport(page)).not.toHaveAttribute('inert', '');
		await expectStableScroll(observation);
		await page.mouse.move(700, 600); await page.mouse.wheel(0, 400);
		await expect.poll(/** 弹层关闭后恢复原生滚动。 */ async (): Promise<number> => scrollTop(page)).toBeGreaterThan(saved + 100);
	} finally {
		await disposeObservation(observation);
	}
});

test('移动底栏独立于长内容且保留视口右缘滚动', /** 断点消费现有布局状态，不复制前端断点实现。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openProfile(page);
	await scrollTo(page, 700);
	await expectSingleMainScroll(page);
	const bar: Locator = page.getByTestId('twitter-mobile-bar');
	const bottom: number = await bar.evaluate(/** 常驻栏位于窗口底部，不落到页面末尾。 */ (node: HTMLElement): number => node.getBoundingClientRect().bottom);
	expect(bottom).toBe(844);
	await expect(page.getByTestId('open-post-form')).toBeVisible();
	expect(await viewport(page).evaluate(/** 主内容不横向溢出。 */ (node: HTMLElement): number => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath('profile-mobile-scrolled.png'), animations: 'disabled' });
});

test('异步回访恢复遇到用户滚动后不再强行拉回旧位置', /** 只延迟真实请求，用户输入可以取消待恢复位置。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	const card: Locator = page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').nth(7);
	await card.scrollIntoViewIfNeeded();
	await card.locator('a[href^="/notes/"]').first().click();
	const gate: PromiseWithResolvers<void> = Promise.withResolvers<void>();
	await page.route('**/api/users/notes', /** 请求保持真实，只控制回访时序。 */ async (route: Route): Promise<void> => { await gate.promise; await route.continue(); });
	try {
		await page.goBack();
		await expect(page.getByTestId('twitter-profile')).toBeVisible();
		await page.mouse.move(700, 300); await page.mouse.wheel(0, -2000);
		await expect.poll(/** 用户选择回到顶部。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
		gate.resolve();
		await expect(page.getByTestId('twitter-user-timeline-notes').getByTestId('twitter-note').first()).toBeVisible();
		await expect.poll(/** 内容回来后不强制恢复到之前的中部。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
	} finally { gate.resolve(); }
});

/** 更新浏览器已有偏好档案后重载，由实际启动链读取同一持久化协议。 */
async function setViewPreference(page: Page, key: 'showTitlebar' | 'experimental.stackingRouterView', value: boolean): Promise<void> {
	await page.evaluate(/** 只修改真实启动已持久化的两个 UI 偏好，不创建替代档案。 */ (input: { key: 'showTitlebar' | 'experimental.stackingRouterView'; value: boolean }): void => {
		const stored: string | null = localStorage.getItem('preferences');
		if (stored == null) throw new Error('Expected a persisted preferences profile');
		const profile: PreferencesProfile = JSON.parse(stored) as PreferencesProfile;
		const records: PreferencesProfile['preferences'][typeof input.key] = profile.preferences[input.key];
		if (records == null || records.length === 0) throw new Error('Expected an existing preference record');
		for (const record of records) record[1] = input.value;
		profile.modifiedAt = Date.now();
		localStorage.setItem('preferences', JSON.stringify(profile));
	}, { key, value });
	await page.reload();
}

test('时间线原生分页与新帖排队回顶在带标题栏时保持有效', /** 验证共享组件实际绑定的滚动坐标，而不是仅看条的位置。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await page.goto(`${BASE_URL}/?ui=twitter`);
	await expect(page.locator('[data-twitter-route-outlet]').getByTestId('twitter-note').first()).toBeVisible();
	await setViewPreference(page, 'showTitlebar', true);
	await expect(page.locator('[data-twitter-route-outlet]').getByTestId('twitter-note').first()).toBeVisible();
	await expect.poll(/** 标题栏确实进入布局。 */ async (): Promise<number> => viewport(page).evaluate((node: HTMLElement): number => node.getBoundingClientRect().top)).toBeGreaterThan(0);
	expect(await viewport(page).evaluate(/** 局部原点不受应用标题栏影响。 */ (node: HTMLElement): number => node.offsetTop)).toBe(0);
	await expectSingleMainScroll(page);
	await scrollTo(page, 900);
	const created: Misskey.Endpoints['notes/create']['res'] = await api(BASE_URL, 'notes/create', { i: account.token, text: 'queued while reading older notes' });
	await expect(page.locator('[data-twitter-route-outlet]').getByTestId('twitter-note').filter({ hasText: 'queued while reading older notes' })).toHaveCount(0);
	await expect(page.locator('button').filter({ has: page.locator('i.ti-circle-arrow-up') }).first()).toBeAttached();
	await page.getByTestId('twitter-sidebar').getByRole('link', { name: 'Timeline', exact: true }).last().click();
	await expect(page).toHaveURL(`${BASE_URL}/`);
	await expect.poll(/** 去除 UI 参数的同位置键导航仍通过主宿主回顶。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
	await expect(page.locator(`[data-twitter-route-outlet] [data-note-id="${created.createdNote.id}"]`)).toBeVisible();
	await scrollTo(page, 900);
	await page.getByTestId('twitter-sidebar').getByRole('link', { name: 'Timeline', exact: true }).last().click();
	await expect.poll(/** 完整地址也相同的主动重选仍由 same 事件回顶。 */ async (): Promise<number> => scrollTop(page)).toBeLessThan(2);
	// 滚动到底部触发真实分页，不能只移动一个装饰性的滚动条。
	await viewport(page).evaluate(/** 原生滚动到已加载部分的底部。 */ (node: HTMLElement): void => { node.scrollTop = node.scrollHeight; });
	await expect.poll(/** 列表条目来自下一页真实 API 响应。 */ async (): Promise<number> => page.locator('[data-twitter-route-outlet]').getByTestId('twitter-note').count()).toBeGreaterThan(20);
});

test('通知社区搜索和标签页共享主出口且不残留内部滚动', /** 可达主页面按实际路由挂载，不更改其业务数据。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	for (const path of ['/my/notifications', '/channels']) {
		await page.getByTestId('twitter-sidebar').locator(`a[href="${path}"]`).click();
		await expect(page.locator('[data-twitter-route-outlet] ._pageScrollable')).toBeVisible();
		await expectSingleMainScroll(page);
	}
	await page.goto(`${BASE_URL}/search?ui=twitter`);
	await expect(page.locator('[data-twitter-route-outlet] ._pageScrollable').first()).toBeVisible();
	await expectSingleMainScroll(page);
	await page.goto(`${BASE_URL}/tags/scroll?ui=twitter`);
	await expect(page.locator('[data-twitter-route-outlet] ._pageScrollable')).toBeVisible();
	await expectSingleMainScroll(page);
});

test('独立页面窗口保留自己的滚动边界且不改变主页面位置', /** 页面窗口是实际存量容器，不受主出口 CSS 或位置表接管。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>): Promise<void> => {
	await openProfile(page);
	await page.evaluate(/** 字体排版完成后再记录吸顶头的真实点击坐标。 */ async (): Promise<void> => { await document.fonts.ready; });
	const header: Locator = page.getByTestId('twitter-profile').locator(':scope > header');
	await header.click({ trial: true, button: 'right', position: { x: 220, y: 25 } });
	await scrollTo(page, 500);
	const headerBox: Awaited<ReturnType<Locator['boundingBox']>> = await header.boundingBox();
	if (headerBox == null) throw new Error('Expected a visible profile header');
	// 在当前吸顶头上右击，避免定位器为了整个 header 自动回滚主页面。
	await page.mouse.click(headerBox.x + 220, headerBox.y + 25, { button: 'right' });
	await page.getByRole('menuitem', { name: /Open in window/ }).click();
	await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toHaveCount(2);
	await page.getByRole('button', { name: 'Edit profile', exact: true }).last().click();
	await expect(page.getByTestId('profile-name')).toBeVisible();
	const inner: Locator = page.locator('._pageScrollable').filter({ has: page.getByTestId('profile-name') });
	expect(await inner.evaluate(/** 窗口内部依然是元素滚动，而非 visible 自然流。 */ (node: HTMLElement): string => getComputedStyle(node).overflowY)).toBe('scroll');
	await inner.evaluate(/** 滚动独立窗口，不应连带主视口。 */ (node: HTMLElement): void => { node.scrollTop = 300; });
	expect(await scrollTop(page)).toBe(500);
});

test('既有叠层偏好不被静默重写且仍可进入退出设置', /** 绝对定位叠层仍是有界容器，不能被普通页面自然高度规则破坏。 */ async ({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo): Promise<void> => {
	await openProfile(page);
	await setViewPreference(page, 'experimental.stackingRouterView', true);
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	/** 普通出口和存量叠层共用标记；卡片数量、定位及实际滚动边界证明选择了叠层实现。 */
	const outlet: Locator = page.locator('[data-twitter-route-outlet]');
	await expect(outlet).toHaveCount(1);
	await expect(outlet).toHaveCSS('position', 'relative');
	await expect(outlet.locator(':scope > div')).toHaveCount(1);
	await expect(viewport(page)).toHaveCSS('overflow-y', 'clip');
	await expect(viewport(page)).not.toHaveAttribute('data-twitter-layout', 'messages');
	await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
	await expect(page.getByTestId('profile-name')).toBeVisible();
	await expect(outlet.locator(':scope > div')).toHaveCount(2);
	await expect(outlet.locator(':scope > div').last()).toHaveCSS('position', 'absolute');
	/** 设置页真正叠在原资料页上，两个卡片仍受同一有界出口约束。 */
	const stackedGeometry: Readonly<{ viewportHeight: number; outletHeight: number; cards: number; overlayPosition: string }> = await outlet.evaluate(/** 只投影布局证据，不读取账户或认证数据。 */ (element: HTMLElement): { viewportHeight: number; outletHeight: number; cards: number; overlayPosition: string } => {
		const host: HTMLElement | null = element.closest('[data-twitter-scroll-viewport]');
		const overlay: Element | null = element.lastElementChild;
		return { viewportHeight: host?.clientHeight ?? 0, outletHeight: element.clientHeight, cards: element.childElementCount, overlayPosition: overlay ? getComputedStyle(overlay).position : '' };
	});
	expect(Math.abs(stackedGeometry.viewportHeight - stackedGeometry.outletHeight)).toBeLessThanOrEqual(1);
	await page.goBack();
	await expect(page.getByTestId('twitter-profile')).toBeVisible();
	await expect(page.getByTestId('profile-name')).toHaveCount(0);
	await expect(outlet.locator(':scope > div')).toHaveCount(1);
	await expect(viewport(page)).toHaveCSS('overflow-y', 'clip');
	const persistedStacking: boolean = await page.evaluate(/** 回读真实持久化偏好，证明进入、退出设置均未被 Shell 静默改写。 */ (): boolean => {
		const stored: string | null = localStorage.getItem('preferences');
		if (!stored) return false;
		const profile: PreferencesProfile = JSON.parse(stored) as PreferencesProfile;
		const records: PreferencesProfile['preferences']['experimental.stackingRouterView'] = profile.preferences['experimental.stackingRouterView'];
		return records.length > 0 && records.every(/** 所有既有作用域均应保留测试设置的布尔值。 */ (record: PreferencesProfile['preferences']['experimental.stackingRouterView'][number]): boolean => record[1] === true);
	});
	expect(persistedStacking).toBe(true);
	/** 保存成功路径的独立证据，列表 reporter 结束后仍可复核真实卡片与偏好结果。 */
	const evidencePath: string = info.outputPath('stacking-preference-boundary.json');
	await writeFile(evidencePath, JSON.stringify({ persistedStacking, stackedGeometry, cardsAfterReturn: await outlet.locator(':scope > div').count() }));
	await info.attach('stacking-preference-boundary', { path: evidencePath, contentType: 'application/json' });
});
