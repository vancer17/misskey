/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** 通用 Bootstrap：在启动前会话验证之后编排 Store、账户恢复与应用挂载，不把运行探测下放到组件。 */

import { watch, version as vueVersion } from 'vue';
import { compareVersions } from 'compare-versions';
import { version, lang, isSafeMode } from '@@/js/config.js';
import defaultLightTheme from '@@/themes/l-light.json5';
import defaultDarkTheme from '@@/themes/d-green-lime.json5';
import { storeBootloaderErrors } from '@@/js/store-boot-errors';
import type { App } from 'vue';
import widgets from '@/widgets/index.js';
import directives from '@/directives/index.js';
import components from '@/components/index.js';
import { themeManager } from '@/theme.js';
import { isDeviceDarkmode } from '@/utility/is-device-darkmode.js';
import { i18n } from '@/i18n.js';
import { removeInvalidAccount, updateCurrentAccount, login } from '@/accounts.js';
import { getInvalidSessionReason } from '@/accounts/index.js';
import { store } from '@/store.js';
import { fetchInstance, instance } from '@/instance.js';
import { updateDeviceKind } from '@/utility/device-kind.js';
import { reloadChannel, unisonReload } from '@/utility/unison-reload.js';
import { getUrlWithoutLoginId } from '@/utility/login-id.js';
import { getAccountFromId } from '@/utility/get-account-from-id.js';
import { deckStore } from '@/ui/deck/deck-store.js';
import { analytics, initAnalytics } from '@/analytics.js';
import { miLocalStorage } from '@/local-storage.js';
import { fetchCustomEmojis } from '@/custom-emojis.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';
import { launchPlugins } from '@/plugin.js';
import { initTelemetry } from '@/telemetry.js';

/** 通用启动成功结果；null 表示会话已切换并进入受控重载，不应继续挂载页面。 */
type CommonBootResult = { isClientUpdated: boolean; lastVersion: string | null; app: App<Element> };

/** 在共享状态就绪后挂载应用，并在凭据失效时停止当前启动链。 */
export async function common(createVue: () => Promise<App<Element>>): Promise<CommonBootResult | null> {
	console.info(`Misskey v${version}`);

	if (_DEV_) {
		console.warn('Development mode!!!');

		console.info(`vue ${vueVersion}`);

		window.addEventListener('error', event => {
			console.error(event);
			/*
			alert({
				type: 'error',
				title: 'DEV: Unhandled error',
				text: event.message
			});
			*/
		});

		window.addEventListener('unhandledrejection', event => {
			console.error(event);
			/*
			alert({
				type: 'error',
				title: 'DEV: Unhandled promise rejection',
				text: event.reason
			});
			*/
		});
	}

	let isClientUpdated = false;

	//#region クライアントが更新されたかチェック
	const lastVersion = miLocalStorage.getItem('lastVersion');
	if (lastVersion !== version) {
		miLocalStorage.setItem('lastVersion', version);

		try { // 変なバージョン文字列来るとcompareVersionsでエラーになるため
			if (lastVersion != null && compareVersions(version, lastVersion) === 1) {
				isClientUpdated = true;
			}
		} catch (err) { /* empty */ }
	}
	//#endregion

	//#region Detect language & fetch translations
	storeBootloaderErrors({ ...i18n.ts._bootErrors, reload: i18n.ts.reload });

	if (import.meta.hot) {
		import.meta.hot.on('locale-update',
			/** 合并后的当前语言资源已完整发布，交由正常启动链重新验证并加载。 */
			(updatedLang: string): void => {
				if (updatedLang !== lang) return;
				console.info(`Locale updated: ${updatedLang}`);
				window.location.reload();
			});
	}
	//#endregion

	// タッチデバイスでCSSの:hoverを機能させる
	window.document.addEventListener('touchend', () => {}, { passive: true });

	// URLに#pswpを含む場合は取り除く
	if (window.location.hash === '#pswp') {
		window.history.replaceState(null, '', window.location.href.replace('#pswp', ''));
	}

	// 一斉リロード
	reloadChannel.addEventListener('message', path => {
		if (path !== null) window.location.href = path;
		else window.location.reload();
	});

	//#region Set lang attr
	const html = window.document.documentElement;
	html.setAttribute('lang', lang);
	//#endregion

	await store.ready;
	await deckStore.ready;
	if ($i) await updateCurrentAccount($i);

	const registryResults: PromiseSettledResult<void>[] = await Promise.allSettled([store.loaded, deckStore.loaded]);
	for (const result of registryResults) {
		if (result.status === 'rejected' && $i && getInvalidSessionReason(result.reason) !== null) {
			await removeInvalidAccount({ id: $i.id, token: $i.token });
			unisonReload();
			return null;
		}
	}

	const fetchInstanceMetaPromise = fetchInstance();

	fetchInstanceMetaPromise.then(() => {
		miLocalStorage.setItem('v', instance.version);
	});

	//#region loginId
	const params = new URLSearchParams(window.location.search);
	const loginId = params.get('loginId');

	if (loginId) {
		const target = getUrlWithoutLoginId(window.location.href);

		if (!$i || $i.id !== loginId) {
			const account = await getAccountFromId(loginId);
			if (account) {
				await login(account.token, target);
			}
		}

		window.history.replaceState({ misskey: 'loginId' }, '', target);
	}
	//#endregion

	//#region Sync dark mode
	if (prefer.s.syncDeviceDarkMode) {
		store.set('darkMode', isDeviceDarkmode());
	}

	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (mql) => {
		if (prefer.s.syncDeviceDarkMode) {
			store.set('darkMode', mql.matches);
		}
	});
	//#endregion

	if (!isSafeMode) {
		// TODO: instance.defaultLightTheme/instance.defaultDarkThemeが不正な形式だった場合のケア
		if (prefer.s.lightTheme == null && instance.defaultLightTheme != null) prefer.commit('lightTheme', JSON.parse(instance.defaultLightTheme));
		if (prefer.s.darkTheme == null && instance.defaultDarkTheme != null) prefer.commit('darkTheme', JSON.parse(instance.defaultDarkTheme));
	}

	// NOTE: この処理は必ずクライアント更新チェック処理より後に来ること(テーマ再構築のため)
	// NOTE: この処理は必ずダークモード判定処理より後に来ること(初回のテーマ適用のため)
	// NOTE: この処理は必ずサーバーテーマ適用処理より後に来ること(二重発火を防ぐため)
	// see: https://github.com/misskey-dev/misskey/issues/16562
	watch(store.r.darkMode, (darkMode) => {
		const theme = (() => {
			if (darkMode) {
				return isSafeMode ? defaultDarkTheme : (prefer.s.darkTheme ?? defaultDarkTheme);
			} else {
				return isSafeMode ? defaultLightTheme : (prefer.s.lightTheme ?? defaultLightTheme);
			}
		})();

		themeManager.updateTheme(theme);
	}, { immediate: true });

	window.document.documentElement.dataset.colorScheme = store.s.darkMode ? 'dark' : 'light';

	if (!isSafeMode) {
		watch(prefer.r.darkTheme, (theme) => {
			if (store.s.darkMode) {
				themeManager.updateTheme(theme ?? defaultDarkTheme);
			}
		});

		watch(prefer.r.lightTheme, (theme) => {
			if (!store.s.darkMode) {
				themeManager.updateTheme(theme ?? defaultLightTheme);
			}
		});
	}

	watch(prefer.r.overridedDeviceKind, (kind) => {
		updateDeviceKind(kind);
	}, { immediate: true });

	watch(prefer.r.useBlurEffectForModal, v => {
		window.document.documentElement.style.setProperty('--MI-modalBgFilter', v ? 'blur(4px)' : 'none');
	}, { immediate: true });

	watch(prefer.r.useBlurEffect, v => {
		if (v) {
			window.document.documentElement.style.removeProperty('--MI-blur');
		} else {
			window.document.documentElement.style.setProperty('--MI-blur', 'none');
		}
	}, { immediate: true });

	// Keep screen on
	const onVisibilityChange = () => window.document.addEventListener('visibilitychange', () => {
		if (window.document.visibilityState === 'visible') {
			navigator.wakeLock.request('screen');
		}
	});
	if (prefer.s.keepScreenOn && 'wakeLock' in navigator) {
		navigator.wakeLock.request('screen')
			.then(onVisibilityChange)
			.catch(() => {
				// On WebKit-based browsers, user activation is required to send wake lock request
				// https://webkit.org/blog/13862/the-user-activation-api/
				window.document.addEventListener(
					'click',
					() => navigator.wakeLock.request('screen').then(onVisibilityChange),
					{ once: true },
				);
			});
	}

	if (prefer.s.makeEveryTextElementsSelectable) {
		window.document.documentElement.classList.add('forceSelectableAll');
	}

	try {
		await fetchCustomEmojis();
	} catch (err) { /* empty */ }

	// analytics
	fetchInstanceMetaPromise.then(async () => {
		await initAnalytics(instance);

		if ($i) {
			analytics.identify($i.id);
		}

		analytics.page({
			path: window.location.pathname,
		});
	});

	const app = await createVue();

	if (_DEV_) {
		app.config.performance = true;
	}

	widgets(app);
	directives(app);
	components(app);

	// https://github.com/misskey-dev/misskey/pull/8575#issuecomment-1114239210
	// なぜか2回実行されることがあるため、mountするdivを1つに制限する
	const rootEl = ((): HTMLElement => {
		const MISSKEY_MOUNT_DIV_ID = 'misskey_app';

		const currentRoot = window.document.getElementById(MISSKEY_MOUNT_DIV_ID);

		if (currentRoot) {
			console.warn('multiple import detected');
			return currentRoot;
		}

		const root = window.document.createElement('div');
		root.id = MISSKEY_MOUNT_DIV_ID;
		window.document.body.appendChild(root);
		return root;
	})();

	await initTelemetry(instance, app);

	try {
		await launchPlugins();
	} catch (error) {
		console.error('Failed to launch plugins:', error);
	}

	app.mount(rootEl);

	// boot.jsのやつを解除
	window.onerror = null;
	window.onunhandledrejection = null;

	removeSplash();

	//#region Self-XSS 対策メッセージ
	if (!_DEV_) {
		console.log(
			`%c${i18n.ts._selfXssPrevention.warning}`,
			'color: #f00; background-color: #ff0; font-size: 36px; padding: 4px;',
		);
		console.log(
			`%c${i18n.ts._selfXssPrevention.title}`,
			'color: #f00; font-weight: 900; font-family: "Hiragino Sans W9", "Hiragino Kaku Gothic ProN", sans-serif; font-size: 24px;',
		);
		console.log(
			`%c${i18n.ts._selfXssPrevention.description1}`,
			'font-size: 16px; font-weight: 700;',
		);
		console.log(
			`%c${i18n.ts._selfXssPrevention.description2}`,
			'font-size: 16px;',
			'font-size: 20px; font-weight: 700; color: #f00;',
		);
		console.log(i18n.tsx._selfXssPrevention.description3({ link: 'https://misskey-hub.net/docs/for-users/resources/self-xss/' }));
	}
	//#endregion

	return {
		isClientUpdated,
		lastVersion,
		app,
	};
}

function removeSplash() {
	const splash = window.document.getElementById('splash');
	if (splash) {
		splash.style.opacity = '0';
		splash.style.pointerEvents = 'none';

		// transitionendイベントが発火しない場合があるため
		window.setTimeout(() => {
			splash.remove();
		}, 1000);
	}
}
