/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 二维码浏览器设备适配测试：验证原生失败、最小权限请求、设备枚举、生命周期订阅和媒体释放。
 * 这些隔离用例证明浏览器边界协议；摄像头画面及二维码解码由真实浏览器验收覆盖。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import {
	getQrCameraErrorCode,
	getQrCameraFlashAvailable,
	listQrCameras,
	openQrCamera,
	setQrCameraFlash,
	stopQrCamera,
	subscribeQrCameraChanges,
	subscribeQrCameraEnded,
} from '@/utility/qr-camera.js';
import type { QrCameraErrorCode } from '@/utility/qr-camera.js';

/** 记录适配层唯一允许的媒体申请边界。 */
const requestMedia: Mock<MediaDevices['getUserMedia']> = vi.fn<MediaDevices['getUserMedia']>();
/** 返回测试设备列表，确认枚举不会间接触发媒体申请。 */
const enumerateDevices: Mock<MediaDevices['enumerateDevices']> = vi.fn<MediaDevices['enumerateDevices']>();
/** 使用原生事件分发协议模拟设备插拔，避免将监听行为仅验证为方法调用。 */
let deviceEvents: EventTarget;

/** 可控制生命周期的轨道夹具，仅实现本次设备适配层消费的浏览器接口。 */
type CameraTrackFixture = {
	track: MediaStreamTrack;
	stop: Mock<MediaStreamTrack['stop']>;
	applyConstraints: Mock<MediaStreamTrack['applyConstraints']>;
	end: () => void;
};

/** 构造可主动停止或意外终止的轨道替身，默认视频轨道，并允许验证音频不参与扫描订阅。 */
function createCameraTrack(hasFlash: boolean = false, kind: 'video' | 'audio' = 'video'): CameraTrackFixture {
	let readyState: MediaStreamTrackState = 'live';
	const events: EventTarget = new EventTarget();
	/** 记录停止调用并模拟原生 stop 将轨道同步置为 ended。 */
	const stop: Mock<MediaStreamTrack['stop']> = vi.fn(
		/** 将测试轨道推进到终止状态，供后续释放调用读取。 */
		(): void => { readyState = 'ended'; },
	);
	/** 记录已有轨道收到的约束，不涉及创建额外媒体流。 */
	const applyConstraints: Mock<MediaStreamTrack['applyConstraints']> = vi.fn<MediaStreamTrack['applyConstraints']>().mockResolvedValue(undefined);
	/** 局部替身只暴露适配器实际使用的轨道协议，经 unknown 明确隔离未模拟的原生成员。 */
	const track: MediaStreamTrack = {
		// 调用方指定视频或音频，默认模拟摄像头轨道。
		kind,
		/** 从测试状态读取轨道是否已经停止。 */
		get readyState(): MediaStreamTrackState { return readyState; },
		// 复用可断言调用次数的停止边界。
		stop,
		/** 返回轨道已有的闪光灯能力，不执行设备申请。 */
		getCapabilities(): MediaTrackCapabilities & { torch: boolean } { return { torch: hasFlash }; },
		// 复用可断言参数及原始失败的约束边界。
		applyConstraints,
		// 复用标准事件目标处理监听，保持订阅和解绑的真实协议。
		addEventListener: events.addEventListener.bind(events),
		// 解绑后事件仍可分发，从而证明已清理的页面不再收到更新。
		removeEventListener: events.removeEventListener.bind(events),
	} as unknown as MediaStreamTrack;
	/** 模拟设备意外终止；与原生 stop 一致，主动停止本身不会派发 ended。 */
	const end: () => void = (): void => {
		readyState = 'ended';
		events.dispatchEvent(new Event('ended'));
	};
	return { track, stop, applyConstraints, end };
}

/** 构造持有指定轨道的媒体流替身，避免测试依赖机器的真实摄像头。 */
function createCameraStream(tracks: MediaStreamTrack[]): MediaStream {
	return {
		/** 返回当前流拥有的轨道快照，模拟原生 getTracks 的数组行为。 */
		getTracks(): MediaStreamTrack[] { return [...tracks]; },
		/** 只返回摄像头视频轨道，供闪光灯操作和视频结束监听使用。 */
		getVideoTracks(): MediaStreamTrack[] {
			return tracks.filter(
				/** 按轨道原生种类排除音频，保持浏览器 getVideoTracks 的契约。 */
				(track: MediaStreamTrack): boolean => track.kind === 'video',
			);
		},
	} as MediaStream;
}

/** 构造浏览器设备描述；空标签模拟尚未获准公开摄像头名称的情况。 */
function createDeviceInfo(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
	return {
		deviceId,
		groupId: 'qr-camera-test',
		kind,
		label,
		/** 提供浏览器设备描述的 JSON 投影，使夹具完整符合原生类型。 */
		toJSON(): Record<string, string> { return { deviceId, groupId: 'qr-camera-test', kind, label }; },
	};
}

beforeEach(
	/** 每个用例独立设置安全浏览器边界，且默认没有已打开的设备。 */
	(): void => {
		requestMedia.mockReset();
		enumerateDevices.mockReset();
		deviceEvents = new EventTarget();
		vi.stubGlobal('isSecureContext', true);
		vi.stubGlobal('navigator', { mediaDevices: Object.assign(deviceEvents, { getUserMedia: requestMedia, enumerateDevices }) });
	},
);

afterEach(
	/** 撤销本用例的浏览器全局替身，避免能力判定泄漏至后续用例。 */
	(): void => { vi.unstubAllGlobals(); },
);

describe('二维码摄像头设备适配',
	/** 验证设备边界不再把不同原生失败都折叠为找不到摄像头。 */
	(): void => {
		it('在非安全页面直接返回准确分类，不尝试设备或权限请求',
			/** 非安全上下文优先于缺少 API，避免把访问方式误报成设备不存在。 */
			async (): Promise<void> => {
				vi.stubGlobal('isSecureContext', false);
				vi.stubGlobal('navigator', { mediaDevices: undefined });
				expect(await openQrCamera().catch(getQrCameraErrorCode)).toBe('insecureContext');
				expect(await listQrCameras().catch(getQrCameraErrorCode)).toBe('insecureContext');
				expect(requestMedia).not.toHaveBeenCalled();
				expect(enumerateDevices).not.toHaveBeenCalled();
			},
		);

		it('在安全页面缺少媒体 API 时返回浏览器不支持的分类',
			/** 缺少接口不会暴露 TypeError 或第三方英文提示。 */
			async (): Promise<void> => {
				vi.stubGlobal('navigator', { mediaDevices: undefined });
				expect(await openQrCamera().catch(getQrCameraErrorCode)).toBe('unavailable');
				expect(await listQrCameras().catch(getQrCameraErrorCode)).toBe('unavailable');
			},
		);

		it('默认只申请视频并允许没有后置摄像头的桌面浏览器自行选择设备',
			/** 面向环境的偏好必须是 ideal，不能使只有前置摄像头的设备失败。 */
			async (): Promise<void> => {
				const stream: MediaStream = createCameraStream([]);
				requestMedia.mockResolvedValue(stream);
				await expect(openQrCamera()).resolves.toBe(stream);
				expect(requestMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { facingMode: { ideal: 'environment' } } });
			},
		);

		it('保留选定设备的原生拒绝，且不会重复询问权限或悄悄换摄像头',
			/** 设备请求只发生一次，异常对象的身份及详细信息交由页面继续处理。 */
			async (): Promise<void> => {
				const failure: DOMException = new DOMException('Permission blocked by the document policy.', 'NotAllowedError');
				requestMedia.mockRejectedValue(failure);
				await expect(openQrCamera('selected-camera')).rejects.toBe(failure);
				expect(requestMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { deviceId: { exact: 'selected-camera' } } });
				expect(getQrCameraErrorCode(failure)).toBe('permissionDenied');
			},
		);

		it.each<[string, QrCameraErrorCode]>([
			['NotAllowedError', 'permissionDenied'],
			['SecurityError', 'permissionDenied'],
			['NotFoundError', 'notFound'],
			['NotReadableError', 'notReadable'],
			['OverconstrainedError', 'constraints'],
			['AbortError', 'unknown'],
		])('将原生 %s 映射为 %s',
			/** 依据浏览器错误名称映射，保留没有专门分类的异常为未知失败。 */
			(name: string, expectedCode: QrCameraErrorCode): void => {
				expect(getQrCameraErrorCode(new DOMException('native detail', name))).toBe(expectedCode);
			},
		);

		it('不根据英文错误文本猜测设备状态，并接受跨上下文的原生异常形态',
			/** 字符串无法证明摄像头不存在；结构化 name 不依赖 instanceof DOMException。 */
			(): void => {
				expect(getQrCameraErrorCode('Camera not found.')).toBe('unknown');
				expect(getQrCameraErrorCode(null)).toBe('unknown');
				expect(getQrCameraErrorCode({ name: 'NotReadableError', message: 'device busy' })).toBe('notReadable');
			},
		);

		it('枚举仅返回视频设备和浏览器已有标签，不额外申请临时媒体流',
			/** 设备标签为空时由视图补充本地化名称，适配层不为标签申请权限。 */
			async (): Promise<void> => {
				enumerateDevices.mockResolvedValue([
					createDeviceInfo('audioinput', 'microphone', 'Microphone'),
					createDeviceInfo('videoinput', 'front', ''),
					createDeviceInfo('audiooutput', 'speaker', 'Speaker'),
					createDeviceInfo('videoinput', 'back', 'Back camera'),
				]);
				await expect(listQrCameras()).resolves.toEqual([{ id: 'front', label: '' }, { id: 'back', label: 'Back camera' }]);
				expect(requestMedia).not.toHaveBeenCalled();
			},
		);

		it('仅按非空设备标识去重，保留同名摄像头和未公开标识的独立条目',
			/** 标签与空标识不能证明物理设备相同，避免把多个可见输入错误合并。 */
			async (): Promise<void> => {
				enumerateDevices.mockResolvedValue([
					createDeviceInfo('videoinput', 'front', 'Camera'),
					createDeviceInfo('videoinput', 'front', 'Duplicate front entry'),
					createDeviceInfo('videoinput', 'back', 'Camera'),
					createDeviceInfo('videoinput', '', ''),
					createDeviceInfo('videoinput', '', ''),
				]);
				await expect(listQrCameras()).resolves.toEqual([
					{ id: 'front', label: 'Camera' },
					{ id: 'back', label: 'Camera' },
					{ id: '', label: '' },
					{ id: '', label: '' },
				]);
				expect(requestMedia).not.toHaveBeenCalled();
			},
		);

		it('设备变化订阅独立交付通知，并允许每个会话重复取消订阅',
			/** 原生事件分发验证解绑有效，且监听本身不会枚举设备或申请媒体流。 */
			(): void => {
				const firstChanged: Mock<() => void> = vi.fn<() => void>();
				const secondChanged: Mock<() => void> = vi.fn<() => void>();
				const removeListener: MockInstance<EventTarget['removeEventListener']> = vi.spyOn(deviceEvents, 'removeEventListener');
				const unsubscribeFirst: () => void = subscribeQrCameraChanges(firstChanged);
				const unsubscribeSecond: () => void = subscribeQrCameraChanges(secondChanged);

				deviceEvents.dispatchEvent(new Event('devicechange'));
				expect(firstChanged).toHaveBeenCalledOnce();
				expect(secondChanged).toHaveBeenCalledOnce();
				unsubscribeFirst();
				unsubscribeFirst();
				deviceEvents.dispatchEvent(new Event('devicechange'));
				expect(firstChanged).toHaveBeenCalledOnce();
				expect(secondChanged).toHaveBeenCalledTimes(2);
				unsubscribeSecond();
				unsubscribeSecond();
				deviceEvents.dispatchEvent(new Event('devicechange'));
				expect(secondChanged).toHaveBeenCalledTimes(2);
				expect(removeListener).toHaveBeenCalledTimes(2);
				expect(requestMedia).not.toHaveBeenCalled();
				expect(enumerateDevices).not.toHaveBeenCalled();
			},
		);

		it('非安全上下文和缺少媒体接口时设备订阅提供可重复的空清理',
			/** 订阅能力缺失不会抢先产生页面错误，实际开流边界继续提供准确分类。 */
			(): void => {
				const changed: Mock<() => void> = vi.fn<() => void>();
				vi.stubGlobal('isSecureContext', false);
				const unsubscribeInsecure: () => void = subscribeQrCameraChanges(changed);
				unsubscribeInsecure();
				unsubscribeInsecure();
				deviceEvents.dispatchEvent(new Event('devicechange'));

				vi.stubGlobal('isSecureContext', true);
				vi.stubGlobal('navigator', { mediaDevices: undefined });
				const unsubscribeUnavailable: () => void = subscribeQrCameraChanges(changed);
				unsubscribeUnavailable();
				unsubscribeUnavailable();
				expect(changed).not.toHaveBeenCalled();
				expect(requestMedia).not.toHaveBeenCalled();
				expect(enumerateDevices).not.toHaveBeenCalled();
			},
		);

		it('仅有媒体方法而没有设备事件接口时监听安全降级',
			/** 可以通过用户操作刷新设备清单的浏览器，不应因缺少事件订阅而无法进入扫描页。 */
			(): void => {
				const changed: Mock<() => void> = vi.fn<() => void>();
				vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: requestMedia, enumerateDevices } });
				const unsubscribe: () => void = subscribeQrCameraChanges(changed);
				unsubscribe();
				unsubscribe();
				expect(changed).not.toHaveBeenCalled();
				expect(requestMedia).not.toHaveBeenCalled();
				expect(enumerateDevices).not.toHaveBeenCalled();
			},
		);

		it('轨道结束订阅只交付已有视频轨道事件，排除音频且不申请新流',
			/** 多视频轨道都属于当前流，音频的终止不能改变二维码摄像头状态。 */
			(): void => {
				const first: CameraTrackFixture = createCameraTrack();
				const second: CameraTrackFixture = createCameraTrack();
				const audio: CameraTrackFixture = createCameraTrack(false, 'audio');
				const ended: Mock<() => void> = vi.fn<() => void>();
				const unsubscribe: () => void = subscribeQrCameraEnded(createCameraStream([first.track, audio.track, second.track]), ended);
				audio.end();
				expect(ended).not.toHaveBeenCalled();
				first.end();
				second.end();
				expect(ended).toHaveBeenCalledTimes(2);
				unsubscribe();
				expect(first.stop).not.toHaveBeenCalled();
				expect(second.stop).not.toHaveBeenCalled();
				expect(audio.stop).not.toHaveBeenCalled();
				expect(requestMedia).not.toHaveBeenCalled();
				expect(enumerateDevices).not.toHaveBeenCalled();
			},
		);

		it('清理使用订阅时的轨道快照，流移除轨道后仍解绑一次并抑制迟到事件',
			/** 扫码器可以先改写 srcObject 的轨道集合，取消订阅仍必须释放原有监听。 */
			(): void => {
				const fixture: CameraTrackFixture = createCameraTrack();
				const tracks: MediaStreamTrack[] = [fixture.track];
				const ended: Mock<() => void> = vi.fn<() => void>();
				const removeListener: MockInstance<MediaStreamTrack['removeEventListener']> = vi.spyOn(fixture.track, 'removeEventListener');
				const unsubscribe: () => void = subscribeQrCameraEnded(createCameraStream(tracks), ended);
				tracks.length = 0;
				unsubscribe();
				unsubscribe();
				fixture.end();
				expect(ended).not.toHaveBeenCalled();
				expect(removeListener).toHaveBeenCalledExactlyOnceWith('ended', expect.any(Function));
			},
		);

		it('主动停止轨道不被当作意外结束，空视频流也可重复清理',
			/** 正常生命周期退出先解绑再停止；没有视频轨道的流保持无事件操作。 */
			(): void => {
				const fixture: CameraTrackFixture = createCameraTrack();
				const stream: MediaStream = createCameraStream([fixture.track]);
				const ended: Mock<() => void> = vi.fn<() => void>();
				const unsubscribe: () => void = subscribeQrCameraEnded(stream, ended);
				unsubscribe();
				stopQrCamera(stream);
				fixture.end();
				const unsubscribeEmpty: () => void = subscribeQrCameraEnded(createCameraStream([]), ended);
				unsubscribeEmpty();
				unsubscribeEmpty();
				expect(ended).not.toHaveBeenCalled();
				expect(fixture.stop).toHaveBeenCalledOnce();
			},
		);

		it('重复清理会释放全部轨道且不再次操作已结束的轨道',
			/** 离开页面和迟到的成功回调可以安全地清理同一个媒体流。 */
			(): void => {
				const first: CameraTrackFixture = createCameraTrack();
				const second: CameraTrackFixture = createCameraTrack();
				const stream: MediaStream = createCameraStream([first.track, second.track]);
				stopQrCamera(stream);
				stopQrCamera(stream);
				stopQrCamera(null);
				expect(first.stop).toHaveBeenCalledOnce();
				expect(second.stop).toHaveBeenCalledOnce();
				expect(first.track.readyState).toBe('ended');
				expect(second.track.readyState).toBe('ended');
			},
		);

		it('闪光灯只使用已有活动轨道，停止后不重新打开摄像头',
			/** 能力读取和约束更新均复用当前媒体轨道，停止后的调用明确失败。 */
			async (): Promise<void> => {
				const fixture: CameraTrackFixture = createCameraTrack(true);
				const stream: MediaStream = createCameraStream([fixture.track]);
				expect(getQrCameraFlashAvailable(stream)).toBe(true);
				await setQrCameraFlash(stream, true);
				expect(fixture.applyConstraints).toHaveBeenCalledExactlyOnceWith({ advanced: [{ torch: true }] });
				stopQrCamera(stream);
				expect(getQrCameraFlashAvailable(stream)).toBe(false);
				await expect(setQrCameraFlash(stream, false)).rejects.toMatchObject({ name: 'NotSupportedError' });
				expect(fixture.applyConstraints).toHaveBeenCalledOnce();
				expect(requestMedia).not.toHaveBeenCalled();
			},
		);

		it('闪光灯约束的原生失败保持原样，未支持闪光灯的轨道不进入申请路径',
			/** 操作失败不会退化为摄像头重新申请，交由独立闪光灯提示处理。 */
			async (): Promise<void> => {
				const fixture: CameraTrackFixture = createCameraTrack(true);
				const failure: DOMException = new DOMException('Torch constraint rejected.', 'OverconstrainedError');
				fixture.applyConstraints.mockRejectedValue(failure);
				await expect(setQrCameraFlash(createCameraStream([fixture.track]), true)).rejects.toBe(failure);
				expect(getQrCameraFlashAvailable(createCameraStream([createCameraTrack().track]))).toBe(false);
				expect(getQrCameraFlashAvailable(null)).toBe(false);
				expect(requestMedia).not.toHaveBeenCalled();
			},
		);
	},
);
