/*
 * 视频预处理领域：校验压缩前后的音视频轨道，保证失败或取消时不交付不完整的媒体文件。
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
	BufferTarget,
	Conversion,
	ConversionVideoOptions,
	EncodedPacket,
	EncodedPacketSink,
	Input,
	InputTrack,
	Mp4OutputFormat,
	Output,
} from 'mediabunny';

/** 视频压缩所需的媒体参数与当前任务的取消、进度通知接口。 */
export type CompressVideoOptions = {
	bitrate: NonNullable<ConversionVideoOptions['bitrate']>;
	signal: AbortSignal;
	/** 接收当前转换任务的进度。 */
	onProgress: (progress: number) => void;
};

/** 将调用方的取消状态统一转换为可识别的取消异常。 */
function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new DOMException('Video preprocessing was aborted.', 'AbortError');
	}
}

/** 判断轨道是否属于必须完整保留的音视频内容。 */
function isMediaTrack(track: InputTrack): boolean {
	return track.isVideoTrack() || track.isAudioTrack();
}

/** 判断轨道是否包含视频内容，用于比对转换前后的轨道数量。 */
function isVideoTrack(track: InputTrack): boolean {
	return track.isVideoTrack();
}

/** 判断轨道是否包含音频内容，用于比对转换前后的轨道数量。 */
function isAudioTrack(track: InputTrack): boolean {
	return track.isAudioTrack();
}

/**
 * 压缩视频并校验媒体完整性，仅返回保留全部源音视频轨道的 MP4 文件。
 * 转换失败向调用方抛错，由上传器决定原文件回退；取消始终抛出 AbortError。
 */
export async function compressVideo(file: File, options: CompressVideoOptions): Promise<Blob> {
	let sourceInput: Input | null = null;
	let candidateInput: Input | null = null;
	let conversion: Conversion | null = null;
	let cancellation: Promise<void> | null = null;

	/** 请求一次转换取消，并立即接住清理失败，避免产生未处理的 Promise 拒绝。 */
	function cancelConversion(): void {
		if (conversion !== null && cancellation === null) {
			cancellation = conversion.cancel().catch(
				/** 清理错误不能覆盖原始转换错误，也不能把用户取消转换成普通失败。 */
				(): void => {
					// 取消事实由 AbortSignal 判定，原始转换失败由主流程传播。
				},
			);
		}
	}

	options.signal.addEventListener('abort', cancelConversion, { once: true });

	try {
		throwIfAborted(options.signal);
		const media: typeof import('mediabunny') = await import('mediabunny');
		throwIfAborted(options.signal);

		sourceInput = new media.Input({ source: new media.BlobSource(file), formats: media.ALL_FORMATS });
		const sourceTracks: InputTrack[] = (await sourceInput.getTracks()).filter(isMediaTrack);
		throwIfAborted(options.signal);
		const sourceVideoCount: number = sourceTracks.filter(isVideoTrack).length;
		const sourceAudioCount: number = sourceTracks.filter(isAudioTrack).length;

		if (sourceVideoCount === 0) {
			throw new Error('Video compression requires a source video track.');
		}

		const target: BufferTarget = new media.BufferTarget();
		const format: Mp4OutputFormat = new media.Mp4OutputFormat();
		const output: Output = new media.Output({ format, target });
		const initializedConversion: Conversion = await media.Conversion.init({
			input: sourceInput,
			output,
			tracks: 'all',
			video: { bitrate: options.bitrate },
			audio: { discard: false },
		});
		conversion = initializedConversion;
		throwIfAborted(options.signal);

		const hasMissingTrack: boolean = sourceTracks.some(
			/** 每条源音视频轨道都必须实际参与本次转换。 */
			(track: InputTrack): boolean => !initializedConversion.utilizedTracks.includes(track),
		);
		const hasDiscardedTrack: boolean = initializedConversion.discardedTracks.some(
			/** 禁止把舍弃了源音视频轨道的候选文件当作成功结果。 */
			(discardedTrack: Conversion['discardedTracks'][number]): boolean => sourceTracks.includes(discardedTrack.track),
		);

		if (!initializedConversion.isValid || hasMissingTrack || hasDiscardedTrack) {
			throw new Error('Video compression would discard required media tracks.');
		}

		/** 只向仍然有效的任务报告转换进度。 */
		initializedConversion.onProgress = (progress: number): void => {
			if (!options.signal.aborted) {
				options.onProgress(progress);
			}
		};
		await initializedConversion.execute();
		throwIfAborted(options.signal);

		const buffer: ArrayBuffer | null = target.buffer;
		if (buffer === null || buffer.byteLength === 0) {
			throw new Error('Video compression produced an empty file.');
		}

		const candidate: Blob = new Blob([buffer], { type: format.mimeType });
		candidateInput = new media.Input({ source: new media.BlobSource(candidate), formats: media.ALL_FORMATS });
		const candidateTracks: InputTrack[] = (await candidateInput.getTracks()).filter(isMediaTrack);
		throwIfAborted(options.signal);

		if (candidateTracks.filter(isVideoTrack).length !== sourceVideoCount || candidateTracks.filter(isAudioTrack).length !== sourceAudioCount) {
			throw new Error('Video compression changed the required media track counts.');
		}

		for (let index: number = 0; index < candidateTracks.length; index++) {
			throwIfAborted(options.signal);
			const track: InputTrack = candidateTracks[index];
			const sink: EncodedPacketSink = new media.EncodedPacketSink(track);
			const packet: EncodedPacket | null = await sink.getFirstPacket();
			throwIfAborted(options.signal);

			if (packet === null || packet.data.byteLength === 0) {
				throw new Error('Video compression produced a media track without encoded data.');
			}

			if (track.isVideoTrack()) {
				const [width, height]: [number, number] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]);
				throwIfAborted(options.signal);
				if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
					throw new Error('Video compression produced invalid video dimensions.');
				}
			}
		}

		throwIfAborted(options.signal);
		return candidate;
	} catch (error: unknown) {
		throwIfAborted(options.signal);
		throw error;
	} finally {
		options.signal.removeEventListener('abort', cancelConversion);
		cancelConversion();
		if (cancellation !== null) {
			await cancellation;
		}
		try {
			candidateInput?.dispose();
		} finally {
			sourceInput?.dispose();
		}
		throwIfAborted(options.signal);
	}
}
