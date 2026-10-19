/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * 二维码浏览器设备适配领域：申请、枚举和释放摄像头媒体流，订阅设备与轨道变化，并操作已有轨道的闪光灯。
 * 原生设备错误保留在调用边界，由页面将稳定错误码映射为本地化反馈；此模块不启动二维码解码器。
 */

/** 摄像头适配边界向二维码视图提供的失败分类，不携带第三方库的显示文案。 */
export type QrCameraErrorCode =
	// 当前网页不在浏览器允许访问摄像头的安全上下文中。
	| 'insecureContext'
	// 浏览器未提供所需的媒体设备接口。
	| 'unavailable'
	// 浏览器权限或文档策略拒绝访问摄像头。
	| 'permissionDenied'
	// 当前没有可用的摄像头设备。
	| 'notFound'
	// 设备存在，但浏览器无法读取视频流。
	| 'notReadable'
	// 所选设备或媒体约束无法满足。
	| 'constraints'
	// 浏览器返回了尚未分类的异常。
	| 'unknown';

/** 摄像头选择列表的只读投影；空标签由视图使用本地化名称补充。 */
export type QrCameraDevice = Readonly<{
	id: string;
	label: string;
}>;

/** 媒体 API 调用前的能力失败；原生调用失败不包装，以保留浏览器异常及其原因。 */
class QrCameraError extends Error {
	/** 将适配层主动识别的失败传给页面的统一错误分类入口。 */
	constructor(public readonly code: QrCameraErrorCode) {
		super(code);
		this.name = 'QrCameraError';
	}
}

/** 在实际设备操作时取得浏览器接口，避免组件探测环境或导入模块时请求设备。 */
function getQrMediaDevices(): MediaDevices {
	if (!globalThis.isSecureContext) {
		throw new QrCameraError('insecureContext');
	}

	const mediaDevices: MediaDevices | undefined = globalThis.navigator?.mediaDevices;
	if (!mediaDevices) {
		throw new QrCameraError('unavailable');
	}

	return mediaDevices;
}

/**
 * 为二维码扫描申请一次视频流；默认倾向后置摄像头，指定设备时严格使用该设备。
 * getUserMedia 的原生异常原样向上传递，调用方负责释放成功返回的流。
 *
 * @param deviceId 用户选择的设备标识，省略时让浏览器选择可用摄像头。
 * @returns 浏览器授予的视频媒体流。
 */
export async function openQrCamera(deviceId?: string): Promise<MediaStream> {
	const mediaDevices: MediaDevices = getQrMediaDevices();
	if (typeof mediaDevices.getUserMedia !== 'function') {
		throw new QrCameraError('unavailable');
	}

	return mediaDevices.getUserMedia({
		// 扫描只需要画面，不申请麦克风权限。
		audio: false,
		// 明确选择的设备不得被重试逻辑替换为另一个摄像头。
		video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } },
	});
}

/**
 * 读取当前已获准公开的摄像头列表，不为获取设备标签而另外申请临时视频流。
 * 只对非空设备标识去重，名称相同或未公开标识的条目仍由浏览器清单独立表示。
 *
 * @returns 浏览器返回的视频输入设备及其当前可见标签。
 */
export async function listQrCameras(): Promise<QrCameraDevice[]> {
	const mediaDevices: MediaDevices = getQrMediaDevices();
	if (typeof mediaDevices.enumerateDevices !== 'function') {
		throw new QrCameraError('unavailable');
	}

	const devices: MediaDeviceInfo[] = await mediaDevices.enumerateDevices();
	const cameras: QrCameraDevice[] = [];
	const cameraIds: Set<string> = new Set<string>();
	for (const device of devices) {
		if (device.kind === 'videoinput') {
			if (device.deviceId && cameraIds.has(device.deviceId)) continue;
			cameras.push({ id: device.deviceId, label: device.label });
			if (device.deviceId) cameraIds.add(device.deviceId);
		}
	}
	return cameras;
}

/**
 * 订阅浏览器公开的设备变化通知，不为监听或刷新设备清单而申请媒体流。
 * 非安全上下文或缺少事件接口时返回空清理，设备可用性仍由实际设备操作判断。
 *
 * @param onChange 设备变化后由页面刷新当前会话设备清单的回调。
 * @returns 可重复调用的取消订阅函数。
 */
export function subscribeQrCameraChanges(onChange: () => void): () => void {
	const mediaDevices: MediaDevices | undefined = globalThis.isSecureContext ? globalThis.navigator?.mediaDevices : undefined;
	if (!mediaDevices || typeof mediaDevices.addEventListener !== 'function' || typeof mediaDevices.removeEventListener !== 'function') {
		/** 无可订阅设备接口时允许页面沿用统一的生命周期清理入口。 */
		return (): void => {
			// 没有已绑定的设备监听，重复清理保持无副作用。
		};
	}

	let subscribed: boolean = true;
	/** 仅向仍活动的订阅交付设备变化，避免清理后的迟到通知更新页面。 */
	const handleChange: () => void = (): void => {
		if (subscribed) onChange();
	};
	mediaDevices.addEventListener('devicechange', handleChange);

	/** 使用订阅时的设备对象解绑一次，不读取后续可能变化的浏览器全局对象。 */
	return (): void => {
		if (!subscribed) return;
		subscribed = false;
		mediaDevices.removeEventListener('devicechange', handleChange);
	};
}

/**
 * 订阅已有视频轨道的意外结束；音频轨道不参与二维码摄像头状态判断。
 * 页面主动释放媒体流前先取消订阅，避免将正常退出误判为设备中断。
 *
 * @param stream 当前会话已经取得的视频媒体流，不会申请替代流。
 * @param onEnded 视频轨道结束后由页面停止扫描并更新设备状态的回调。
 * @returns 可重复调用的取消订阅函数，即使轨道已被移出媒体流也能正确解绑。
 */
export function subscribeQrCameraEnded(stream: MediaStream, onEnded: () => void): () => void {
	const tracks: MediaStreamTrack[] = stream.getVideoTracks();
	let subscribed: boolean = true;
	/** 将已有视频轨道的终止事件交给仍活动的扫描会话。 */
	const handleEnded: () => void = (): void => {
		if (subscribed) onEnded();
	};
	for (const track of tracks) {
		track.addEventListener('ended', handleEnded);
	}

	/** 从订阅时保存的轨道快照解绑，兼容扫码器先从流中移除轨道的清理顺序。 */
	return (): void => {
		if (!subscribed) return;
		subscribed = false;
		for (const track of tracks) {
			track.removeEventListener('ended', handleEnded);
		}
	};
}

/**
 * 将适配层失败或浏览器原生异常映射到视图可本地化的类别，不改写原异常。
 *
 * @param error 摄像头操作边界捕获的未知异常。
 * @returns 供页面选择本地化提示的稳定错误码。
 */
export function getQrCameraErrorCode(error: unknown): QrCameraErrorCode {
	if (error instanceof QrCameraError) return error.code;
	const name: unknown = typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;

	switch (name) {
		case 'NotAllowedError':
		case 'SecurityError':
			return 'permissionDenied';
		case 'NotFoundError':
			return 'notFound';
		case 'NotReadableError':
			return 'notReadable';
		case 'OverconstrainedError':
			return 'constraints';
		default:
			return 'unknown';
	}
}

/**
 * 释放调用方持有的媒体流，允许重复调用以及尚未取得流时调用。
 *
 * @param stream 待停止的媒体流，null 表示当前没有已取得的流。
 */
export function stopQrCamera(stream: MediaStream | null): void {
	if (!stream) return;
	for (const track of stream.getTracks()) {
		if (track.readyState !== 'ended') track.stop();
	}
}

/**
 * 仅读取现有视频轨道的闪光灯能力；能力不可读时保持扫描并隐藏不可用操作。
 *
 * @param stream 已打开的视频流，不会为能力查询另开摄像头。
 * @returns 当前正在使用的轨道是否支持持续闪光灯。
 */
export function getQrCameraFlashAvailable(stream: MediaStream | null): boolean {
	const track: MediaStreamTrack | undefined = stream?.getVideoTracks()[0];
	if (!track || track.readyState !== 'live' || typeof track.getCapabilities !== 'function') return false;

	try {
		const capabilities: MediaTrackCapabilities & { torch?: boolean } = track.getCapabilities();
		return capabilities.torch === true;
	} catch {
		return false;
	}
}

/**
 * 在已经打开的视频轨道上切换闪光灯，并保留 applyConstraints 返回的原生错误。
 *
 * @param stream 页面当前持有的视频流，不会为切换闪光灯申请新流。
 * @param enabled 是否打开持续闪光灯。
 */
export async function setQrCameraFlash(stream: MediaStream | null, enabled: boolean): Promise<void> {
	const track: MediaStreamTrack | undefined = stream?.getVideoTracks()[0];
	if (!track || !getQrCameraFlashAvailable(stream)) {
		throw new DOMException('Camera flash is unavailable.', 'NotSupportedError');
	}

	/** 浏览器图像捕获扩展的轨道约束；DOM 基础声明尚未包含 torch 字段。 */
	const constraint: MediaTrackConstraintSet & { torch: boolean } = {
		// 仅改变当前轨道的持续闪光灯，不改变设备选择或视频尺寸。
		torch: enabled,
	};
	await track.applyConstraints({ advanced: [constraint] });
}
